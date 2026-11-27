"""Pinned binary environments for Kaggle Linux x86_64 T4 workers.

Core versions are pinned. Successful solves are saved as explicit conda locks;
the Kaggle host image, driver, and transitive repository state are recorded.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import urllib.request

MICROMAMBA_URL = "https://api.anaconda.org/download/conda-forge/micromamba/2.0.5/linux-64/micromamba-2.0.5-0.tar.bz2"
MICROMAMBA_SHA256 = "bfc2e3a414d651af7508c49998a12b5cf3c7029d56c5ef37c9a3248cd7faef78"
VGGT_REVISION = "a288dd0f14786c93483e45524328726ab7b1b4ce"
GSPLAT_WHEEL = "https://github.com/nerfstudio-project/gsplat/releases/download/v1.5.3/gsplat-1.5.3%2Bpt24cu124-cp310-cp310-linux_x86_64.whl"
REQUIREMENTS = ["numpy==1.26.4", "scipy==1.14.1", "Pillow==11.0.0", "opencv-python-headless==4.10.0.84",
                "ninja==1.11.1.1", "packaging==24.2",
                "rich==13.9.4", "jaxtyping==0.2.36", "typing_extensions==4.12.2",
                "imageio==2.36.1", "huggingface_hub==0.27.1", "einops==0.8.0", "safetensors==0.5.2"]


def _run(command, *, env=None, capture=False):
    return subprocess.run([str(part) for part in command], check=True, env=env,
                          text=True, stdout=subprocess.PIPE if capture else None).stdout


def prepare(root="/tmp/reconstruction-environment", *, with_vggt=False, output=None):
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        raise RuntimeError("Notebook environment requires Linux x86_64; run setup inside Kaggle")
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    mamba = root / "bin/micromamba"
    if not mamba.exists():
        archive = root / "micromamba.tar.bz2"
        urllib.request.urlretrieve(MICROMAMBA_URL, archive)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != MICROMAMBA_SHA256:
            raise RuntimeError("Micromamba bootstrap SHA256 mismatch")
        with tarfile.open(archive) as bundle:
            member = bundle.getmember("bin/micromamba")
            if not member.isfile():
                raise RuntimeError("Micromamba archive has no regular executable")
            (root / "bin").mkdir(exist_ok=True)
            with bundle.extractfile(member) as source, mamba.open("wb") as target:
                shutil.copyfileobj(source, target)
        mamba.chmod(0o755)
    base_env = dict(os.environ, MAMBA_ROOT_PREFIX=str(root / "mamba"), QT_QPA_PLATFORM="offscreen")
    tools = root / "sfm"
    training = root / "training"
    if not (tools / "conda-meta/history").exists():
        _run([mamba, "create", "-y", "-p", tools, "--override-channels", "-c", "conda-forge",
              "python=3.11.11", "colmap=3.13.0=cpu_h5de0465_4", "glomap=1.2.0=cpu_py311h183125e_1",
              "ffmpeg=7.1.1"], env=base_env)
    if not (training / "conda-meta/history").exists():
        _run([mamba, "create", "-y", "-p", training, "--override-channels", "-c", "conda-forge",
              "python=3.10.16", "pip=24.3.1"], env=base_env)
    python = training / "bin/python"
    env = dict(base_env, PATH=os.pathsep.join([str(training / "bin"), str(tools / "bin"), base_env.get("PATH", "")]),
               TORCH_CUDA_ARCH_LIST="7.5", CUDA_VISIBLE_DEVICES="0", MAX_JOBS="2",
               VGGT_CODE_REVISION=VGGT_REVISION)
    marker = training / ".reconstruction-core-v1"
    if not marker.exists():
        _run([python, "-m", "pip", "install", "torch==2.4.1", "torchvision==0.19.1",
              "--index-url", "https://download.pytorch.org/whl/cu124"], env=env)
        _run([python, "-m", "pip", "install", *REQUIREMENTS], env=env)
        _run([python, "-m", "pip", "install", "--no-deps", GSPLAT_WHEEL], env=env)
        marker.touch()
    if with_vggt:
        _run([python, "-m", "pip", "install", "--no-deps",
              f"https://github.com/facebookresearch/vggt/archive/{VGGT_REVISION}.zip"], env=env)
    for name in ("ffmpeg", "colmap", "glomap"):
        if shutil.which(name, path=env["PATH"]) is None:
            raise RuntimeError(f"Environment is missing {name}")
    # Exercise the precompiled extension and backward pass before starting a long reconstruction.
    smoke = """
import json, torch, importlib.metadata
if not torch.cuda.is_available(): raise RuntimeError('No CUDA GPU; enable a T4 accelerator')
if torch.cuda.get_device_capability(0) != (7, 5): raise RuntimeError('Expected a T4 sm_75 GPU')
from gsplat import rasterization
device='cuda'
means=torch.tensor([[0.,0.,2.]], device=device, requires_grad=True)
quats=torch.tensor([[1.,0.,0.,0.]], device=device)
scales=torch.full((1,3), .1, device=device)
opacities=torch.full((1,), .5, device=device)
colors=torch.ones((1,3), device=device)
viewmats=torch.eye(4,device=device)[None]
Ks=torch.tensor([[[16.,0.,8.],[0.,16.,8.],[0.,0.,1.]]],device=device)
render,alpha,meta=rasterization(means,quats,scales,opacities,colors,viewmats,Ks,16,16)
render.sum().backward()
assert torch.isfinite(means.grad).all()
print(json.dumps({'torch':torch.__version__,'cuda':torch.version.cuda,'gsplat':importlib.metadata.version('gsplat'),
 'gpu':torch.cuda.get_device_name(0),'capability':list(torch.cuda.get_device_capability(0))}))
"""
    versions = _run([python, "-c", smoke], env=env, capture=True)
    report = {"host": platform.platform(), "python": "3.10.16", "core": json.loads(versions.strip().splitlines()[-1]),
              "sfm": "COLMAP 3.13.0 CPU / GLOMAP 1.2.0 CPU", "vggt_revision": VGGT_REVISION if with_vggt else None,
              "driver": _run(["nvidia-smi", "--query-gpu=driver_version,name", "--format=csv,noheader"], capture=True).strip(),
              "gsplat_wheel": GSPLAT_WHEEL}
    destination = Path(output or root)
    destination.mkdir(parents=True, exist_ok=True)
    for label, prefix in (("sfm", tools), ("training", training)):
        # micromamba 2.0 lists installed packages in conda-meta; the "list --explicit"
        # switch varies by release. These are the exact artifacts installed by the solve.
        records = [json.loads(p.read_text()) for p in sorted((prefix / "conda-meta").glob("*.json"))]
        urls = [record["url"] for record in records]
        (destination / f"environment-{label}.explicit.txt").write_text("@EXPLICIT\n" + "\n".join(urls) + "\n")
    (destination / "environment-pip-freeze.txt").write_text(_run([python, "-m", "pip", "freeze"], env=env, capture=True))
    (destination / "environment.json").write_text(json.dumps(report, indent=2))
    return {"python": str(python), "environment": env}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/kaggle/working/reconstruction-environment")
    parser.add_argument("--output")
    parser.add_argument("--vggt", action="store_true")
    args = parser.parse_args()
    prepare(args.root, with_vggt=args.vggt, output=args.output)
