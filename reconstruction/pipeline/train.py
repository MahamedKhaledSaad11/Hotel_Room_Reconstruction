"""CUDA training using gsplat 1.5.x rasterization and adaptive DefaultStrategy."""
import importlib.metadata
from pathlib import Path
import time

import numpy as np
from PIL import Image

from .common import emit, write_json
from .poses import quaternion_matrix

SH_C0 = 0.28209479177387814


def split_frames(frames, every):
    if len(frames) < 3:
        raise ValueError("At least three registered frames required for training and held-out evaluation")
    holdout = [f for i, f in enumerate(frames) if i % every == 0]
    train = [f for i, f in enumerate(frames) if i % every != 0]
    if len(train) < 2 or not holdout:
        raise ValueError("Invalid training/holdout split")
    return train, holdout


def camera_arrays(frame, cameras):
    c = cameras[str(frame["camera_id"])]
    view = np.eye(4, dtype=np.float32)
    view[:3, :3] = quaternion_matrix(frame["qvec_wxyz"])
    view[:3, 3] = frame["tvec_xyz"]
    k = np.array([[c["fx"], 0, c["cx"]], [0, c["fy"], c["cy"]], [0, 0, 1]], dtype=np.float32)
    return view, k, c


def train_gaussians(config, model, callback=None):
    import torch
    import torch.nn.functional as F
    from scipy.spatial import cKDTree
    from gsplat import rasterization
    from gsplat.strategy import DefaultStrategy

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA PyTorch is required for real gsplat training; no fake/CPU reconstruction is produced")
    if config.device != "cuda":
        torch.cuda.set_device(config.device)
    torch.cuda.reset_peak_memory_stats(config.device)
    torch.manual_seed(config.seed)
    np_rng = np.random.default_rng(config.seed)
    train_frames, holdout_frames = split_frames(model["frames"], config.holdout_every)
    points, colors = model["points"], model["colors"].astype(np.float32) / 255
    if len(points) > config.initial_points:
        chosen = np_rng.choice(len(points), config.initial_points, replace=False)
        points, colors = points[chosen], colors[chosen]
    distances, _ = cKDTree(points).query(points, k=min(4, len(points)))
    spacing = np.sqrt(np.maximum(np.mean(distances[:, 1:]**2, axis=1), 1e-10))
    centers = np.array([-quaternion_matrix(f["qvec_wxyz"]).T @ np.asarray(f["tvec_xyz"]) for f in model["frames"]])
    scene_scale = max(float(np.linalg.norm(centers - centers.mean(axis=0), axis=1).max()), 1e-3)
    device = config.device
    def tensor(array):
        return torch.as_tensor(array, dtype=torch.float32, device=device)
    quats = np.zeros((len(points), 4), np.float32)
    quats[:, 0] = 1
    params = torch.nn.ParameterDict({
        "means": torch.nn.Parameter(tensor(points)),
        "scales": torch.nn.Parameter(tensor(np.log(spacing[:, None].repeat(3, axis=1)))),
        "quats": torch.nn.Parameter(tensor(quats)),
        "opacities": torch.nn.Parameter(tensor(np.full(len(points), np.log(0.1/0.9)))),
        "sh0": torch.nn.Parameter(tensor(((colors - 0.5) / SH_C0)[:, None, :])),
        "shN": torch.nn.Parameter(tensor(np.zeros((len(points), (config.sh_degree+1)**2-1, 3), np.float32))),
    })
    rates = {"means": 1.6e-4 * scene_scale, "scales": 5e-3, "quats": 1e-3,
             "opacities": 5e-2, "sh0": 2.5e-3, "shN": 1.25e-4}
    optimizers = {key: torch.optim.Adam([value], lr=rates[key], eps=1e-15) for key, value in params.items()}
    # Scale refinement timing to short experimental runs, while retaining Adam state on topology edits.
    strategy = DefaultStrategy(refine_start_iter=max(10, min(500, config.iterations//10)),
                               refine_stop_iter=max(1, int(config.iterations*0.75)),
                               refine_every=max(10, min(100, config.iterations//20)),
                               reset_every=max(100, min(3000, config.iterations//2)),
                               pause_refine_after_reset=len(train_frames), verbose=False)
    strategy.check_sanity(params, optimizers)
    state = strategy.initialize_state(scene_scale=scene_scale)
    root = Path(config.output)
    evaluation_dir = root / "evaluation"
    evaluation_dir.mkdir(exist_ok=True)
    started, losses = time.monotonic(), []
    progress_every = max(1, min(100, config.iterations//100))

    def image_data(frame):
        view, k, camera = camera_arrays(frame, model["cameras"])
        with Image.open(frame["image_path"]) as image:
            if image.size != (camera["width"], camera["height"]):
                raise ValueError(f"Image/intrinsics dimensions disagree: {frame['filename']}")
            pixels = np.asarray(image.convert("RGB"), dtype=np.float32) / 255
        return tensor(pixels)[None], tensor(view)[None], tensor(k)[None], camera

    def render(view, k, camera, degree):
        return rasterization(means=params["means"], quats=F.normalize(params["quats"], dim=-1),
                             scales=params["scales"].exp(), opacities=params["opacities"].sigmoid(),
                             colors=torch.cat([params["sh0"], params["shN"]], dim=1), sh_degree=degree,
                             viewmats=view, Ks=k, width=camera["width"], height=camera["height"],
                             packed=True, near_plane=max(scene_scale*1e-4, 1e-4), far_plane=scene_scale*1e4)

    def ssim(pred, target):
        x, y = pred.permute(0,3,1,2), target.permute(0,3,1,2)
        avg = lambda value: F.avg_pool2d(value, 11, stride=1, padding=5)
        mx, my = avg(x), avg(y)
        vx, vy, cov = avg(x*x)-mx*mx, avg(y*y)-my*my, avg(x*y)-mx*my
        return (((2*mx*my+0.01**2)*(2*cov+0.03**2))/((mx*mx+my*my+0.01**2)*(vx+vy+0.03**2))).mean()

    permutation = []
    for step in range(config.iterations):
        if not permutation:
            permutation = np_rng.permutation(len(train_frames)).tolist()
        target, view, k, camera = image_data(train_frames[permutation.pop()])
        degree = min(config.sh_degree, step//1000)
        prediction, _, info = render(view, k, camera, degree)
        strategy.step_pre_backward(params, optimizers, state, step, info)
        loss = 0.8 * F.l1_loss(prediction, target) + 0.2 * (1-ssim(prediction, target))
        if not torch.isfinite(loss):
            raise RuntimeError(f"Non-finite training loss at iteration {step+1}")
        loss.backward()
        for optimizer in optimizers.values():
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)
        # A refinement can at most double the population. Disable growth before exceeding the configured cap.
        if len(params["means"]) >= config.max_gaussians//2:
            strategy.grow_grad2d = float("inf")
        strategy.step_post_backward(params, optimizers, state, step, info, packed=True)
        if not len(params["means"]):
            raise RuntimeError("Adaptive pruning removed all Gaussians; inspect input poses/scene scale")
        optimizers["means"].param_groups[0]["lr"] = rates["means"] * (0.01**((step+1)/config.iterations))
        if (step+1) % progress_every == 0 or step == 0 or step+1 == config.iterations:
            measurement = {"iterations_done": step+1, "iterations_total": config.iterations,
                           "gaussians_count": len(params["means"]), "loss": float(loss.detach()),
                           "peak_vram_gb": torch.cuda.max_memory_allocated(device)/1024**3,
                           "wall_time_sec": time.monotonic()-started}
            losses.append(measurement)
            emit(callback, "training_3dgs", 100*(step+1)/config.iterations, f"Training iteration {step+1}/{config.iterations}", measurement)
    torch.cuda.synchronize(device)
    evaluation = []
    with torch.no_grad():
        for frame in holdout_frames:
            target, view, k, camera = image_data(frame)
            prediction, _, _ = render(view, k, camera, min(config.sh_degree, (config.iterations-1)//1000))
            prediction = prediction.clamp(0, 1)
            mse = float(F.mse_loss(prediction, target))
            record = {"frame_id": frame["frame_id"], "psnr_db": float(-10*np.log10(max(mse, 1e-12))),
                      "ssim_box11": float(ssim(prediction, target)), "prediction": f"evaluation/{frame['frame_id']}_pred.png",
                      "reference": f"evaluation/{frame['frame_id']}_reference.png"}
            for name, image in [("pred", prediction), ("reference", target)]:
                Image.fromarray((image[0].cpu().numpy()*255).round().astype(np.uint8)).save(evaluation_dir/f"{frame['frame_id']}_{name}.png")
            evaluation.append(record)
    arrays = {key: value.detach().cpu().numpy() for key, value in params.items()}
    if not all(np.isfinite(value).all() for value in arrays.values()):
        raise RuntimeError("Non-finite trained Gaussian parameters; export refused")
    np.savez_compressed(root/"checkpoint.npz", **arrays)
    metrics = {"iterations_done": config.iterations, "iterations_total": config.iterations, "gaussians_count": len(arrays["means"]),
               "peak_vram_gb": torch.cuda.max_memory_allocated(device)/1024**3, "wall_time_sec": time.monotonic()-started,
               "torch_version": torch.__version__, "gsplat_version": importlib.metadata.version("gsplat"),
               "gpu_name": torch.cuda.get_device_name(device), "scene_scale": scene_scale,
               "train_frame_ids": [f["frame_id"] for f in train_frames], "holdout_frame_ids": [f["frame_id"] for f in holdout_frames],
               "holdout_scope": "Excluded from photometric optimization; poses/SfM use all registered frames.",
               "psnr_db": float(np.mean([r["psnr_db"] for r in evaluation])),
               "ssim_box11": float(np.mean([r["ssim_box11"] for r in evaluation])),
               "evaluation": evaluation, "loss_history": losses}
    write_json(root/"training_metrics.json", metrics)
    return arrays, metrics
