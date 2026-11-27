"""Antimatter15 .splat / conventional 3DGS .ply export and manifest validation."""
import hashlib
import json
import os
from pathlib import Path
import time

import numpy as np

from .common import emit, utc_now, write_json
from .poses import quaternion_matrix

SH_C0 = 0.28209479177387814
VIEWER_MATRIX = np.diag([1., -1., -1., 1.])
SPLAT_DTYPE = np.dtype([("position", "<f4", (3,)), ("scale", "<f4", (3,)),
                        ("rgba", "u1", (4,)), ("rotation", "u1", (4,))])


def write_ply(path, columns):
    """Write scalar columns without a dependency on a platform-specific PLY library."""
    columns = {key: np.asarray(value) for key, value in columns.items()}
    count = len(next(iter(columns.values())))
    if count == 0 or any(value.ndim != 1 or len(value) != count or not np.isfinite(value).all() for value in columns.values()):
        raise ValueError("PLY columns must contain equal numbers of finite scalar values")
    dtype = np.dtype([(key, "u1" if value.dtype == np.uint8 else "<f4") for key, value in columns.items()])
    records = np.empty(count, dtype=dtype)
    header = ["ply", "format binary_little_endian 1.0", f"element vertex {count}"]
    for key, value in columns.items():
        records[key] = value
        header.append(f"property {'uchar' if value.dtype == np.uint8 else 'float'} {key}")
    header.extend(["end_header", ""])
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("wb") as handle:
        handle.write("\n".join(header).encode("ascii"))
        records.tofile(handle)
    os.replace(temporary, path)


def write_gaussians(output, arrays):
    output = Path(output)
    means = np.asarray(arrays["means"], np.float32)
    count = len(means)
    if count == 0 or means.shape != (count, 3):
        raise ValueError("Gaussian means must have nonempty Nx3 shape")
    expected = {"scales": (count, 3), "quats": (count, 4), "opacities": (count,), "sh0": (count, 1, 3)}
    if any(np.asarray(arrays[key]).shape != shape for key, shape in expected.items()):
        raise ValueError("Invalid Gaussian parameter dimensions")
    if any(not np.isfinite(value).all() for value in arrays.values()):
        raise ValueError("Gaussian export contains non-finite parameters")
    if np.asarray(arrays["shN"]).ndim != 3 or arrays["shN"].shape[0] != count or arrays["shN"].shape[2] != 3:
        raise ValueError("Invalid spherical harmonic dimensions")
    with np.errstate(over="raise", invalid="raise"):
        scales = np.exp(arrays["scales"])
    if np.any(scales <= 0):
        raise ValueError("Gaussian scales must be positive")
    norms = np.linalg.norm(arrays["quats"], axis=1, keepdims=True)
    if np.any(norms < 1e-12):
        raise ValueError("Cannot export zero Gaussian quaternion")
    quaternions = arrays["quats"] / norms
    colors = np.clip(arrays["sh0"][:, 0, :] * SH_C0 + 0.5, 0, 1)
    opacity = 1 / (1 + np.exp(-np.clip(arrays["opacities"], -80, 80)))
    records = np.empty(count, dtype=SPLAT_DTYPE)
    records["position"], records["scale"] = means, scales
    records["rgba"][:, :3] = (colors * 255).round().astype(np.uint8)
    records["rgba"][:, 3] = (opacity * 255).round().astype(np.uint8)
    records["rotation"] = np.clip(quaternions*128+128, 0, 255).astype(np.uint8)
    # Sort by estimated contribution, matching common .splat converters.
    ordering = np.argsort(-(scales.prod(axis=1)*opacity))
    temporary = output / "scene.splat.tmp"
    records[ordering].tofile(temporary)
    os.replace(temporary, output / "scene.splat")
    columns = {axis: means[:, i] for i, axis in enumerate("xyz")}
    columns.update({f"n{axis}": np.zeros(count, np.float32) for axis in "xyz"})
    columns.update({f"f_dc_{i}": arrays["sh0"][:, 0, i] for i in range(3)})
    rest = arrays["shN"].transpose(0, 2, 1).reshape(count, -1)
    columns.update({f"f_rest_{i}": rest[:, i] for i in range(rest.shape[1])})
    columns["opacity"] = arrays["opacities"]
    columns.update({f"scale_{i}": arrays["scales"][:, i] for i in range(3)})
    columns.update({f"rot_{i}": quaternions[:, i] for i in range(4)})
    write_ply(output / "scene.ply", columns)
    return count


def validate_export(output):
    """Structural validation only; visual sign-off and novel-view quality remain separate."""
    output = Path(output)
    manifest = json.loads((output / "run_manifest.json").read_text(encoding="utf-8"))
    path = output / "scene.splat"
    if path.stat().st_size == 0 or path.stat().st_size % 32:
        raise ValueError("Invalid .splat record length")
    records = np.memmap(path, dtype=SPLAT_DTYPE, mode="r")
    if not np.isfinite(records["position"]).all() or not np.isfinite(records["scale"]).all() or np.any(records["scale"] <= 0):
        raise ValueError("Invalid Gaussian centers/scales")
    if not np.any(records["rgba"][:, 3] > 0):
        raise ValueError("All exported Gaussians are transparent")
    if len(records) != manifest["gaussian_count"]:
        raise ValueError("Manifest Gaussian count does not match artifact")
    matrix = np.asarray(manifest["viewer_transform"]["colmap_to_threejs_matrix"])
    lo = np.asarray(manifest["viewer_transform"]["scene_bounds_min"])
    hi = np.asarray(manifest["viewer_transform"]["scene_bounds_max"])
    if matrix.shape != (4, 4) or lo.shape != (3,) or hi.shape != (3,) or not np.isfinite(matrix).all() or not np.isfinite([lo, hi]).all() or np.any(lo > hi):
        raise ValueError("Invalid viewer transform/bounds")
    for name in ["scene.ply", "sparse_points.ply"]:
        with (output / name).open("rb") as handle:
            header = handle.read(100_000)
        if not header.startswith(b"ply\n") or b"end_header\n" not in header:
            raise ValueError(f"Invalid PLY header: {name}")
    registered = [f for f in manifest["frames"] if f["status"] == "registered"]
    if len(registered) < 3:
        raise ValueError("Export requires three registered cameras")
    for frame in registered:
        quaternion_matrix(frame["qvec_wxyz"])
        if str(frame["camera_id"]) not in manifest["cameras"] or not np.isfinite(frame["tvec_xyz"]).all():
            raise ValueError("Invalid registered frame")
    return {"gaussian_count": len(records), "registered_frames": len(registered), "structurally_valid": True}


def export_scene(config, extraction, model, arrays, training_metrics, callback=None):
    started = time.monotonic()
    root = Path(config.output)
    emit(callback, "exporting_splat", None, "Writing trained Gaussian artifacts and camera manifest")
    count = write_gaussians(root, arrays)
    sparse = {axis: model["points"][:, i] for i, axis in enumerate("xyz")}
    sparse.update({name: model["colors"][:, i] for i, name in enumerate(["red", "green", "blue"])})
    write_ply(root / "sparse_points.ply", sparse)
    transformed = arrays["means"] @ VIEWER_MATRIX[:3, :3].T
    lo, hi = transformed.min(axis=0).tolist(), transformed.max(axis=0).tolist()
    registered = {f["frame_id"]: f for f in model["frames"]}
    holdout_ids = set(training_metrics["holdout_frame_ids"])
    frames = []
    for source in extraction["frames"]:
        frame = dict(source)
        if frame["frame_id"] in registered:
            pose = dict(registered[frame["frame_id"]])
            pose["image_relative_path"] = str(Path(pose.pop("image_path")).relative_to(root)).replace("\\", "/")
            frame.update(pose)
            camera = model["cameras"][str(frame["camera_id"])]
            frame.update(width=camera["width"], height=camera["height"], split="holdout" if frame["frame_id"] in holdout_ids else "train")
        elif frame["status"] != "dropped":
            frame.update(status="unregistered", dropped_reason="pose_estimation_failed", split=None)
        frames.append(frame)
    first = model["frames"][0]
    r = quaternion_matrix(first["qvec_wxyz"])
    center = -r.T @ np.asarray(first["tvec_xyz"])
    position = VIEWER_MATRIX[:3, :3] @ center
    forward = VIEWER_MATRIX[:3, :3] @ r.T @ np.array([0., 0., 1.])
    up = VIEWER_MATRIX[:3, :3] @ r.T @ np.array([0., -1., 0.])
    camera = model["cameras"][str(first["camera_id"])]
    initial = {"position": position.tolist(), "target": (position+forward).tolist(), "up": up.tolist(),
               "fov": float(np.degrees(2*np.arctan(camera["height"]/(2*camera["fy"]))))}
    artifacts = {"scene_splat": "scene.splat", "scene_ply": "scene.ply", "sparse_cloud": "sparse_points.ply", "manifest": "run_manifest.json"}
    manifest = {"schema_version": 1, "run_id": root.name, "created_at": utc_now(), "source": extraction["source"],
                "pose_estimator": config.pose_estimator, "coordinate_system": "COLMAP world; world-to-camera extrinsics, WXYZ quaternions",
                "world_units": "arbitrary SfM scale; metric room dimensions require an external scale reference",
                "viewer_transform": {"colmap_to_threejs_matrix": VIEWER_MATRIX.tolist(), "scene_bounds_min": lo, "scene_bounds_max": hi},
                "initial_camera": initial, "cameras": model["cameras"], "frames": frames,
                "gaussian_count": count, "artifacts": artifacts,
                "scene_versions": [{"version_id": "original", "kind": "original", "run_id": root.name,
                                    "splat_relative_path": "scene.splat", "ply_relative_path": "scene.ply",
                                    "sparse_cloud_relative_path": "sparse_points.ply", "gaussian_count": count, "rebuild_mode": "initial"}],
                "metrics": {"extraction": extraction["metrics"], "poses": model["metrics"], "training": training_metrics},
                "export_notes": ["scene.ply retains all trained SH coefficients; .splat stores DC color and 8-bit rotation/opacity.",
                                 "Scene bounds are in viewer coordinates; artifact centers remain in COLMAP world coordinates.",
                                 "Structural validation is not visual acceptance; inspect held-out renders and the interactive viewer."],
                "visual_review": "pending", "artifact_metadata": {}}
    for name in ["scene.splat", "scene.ply", "sparse_points.ply"]:
        digest = hashlib.sha256()
        with (root/name).open("rb") as handle:
            for block in iter(lambda: handle.read(1024*1024), b""):
                digest.update(block)
        manifest["artifact_metadata"][name] = {"size_bytes": (root/name).stat().st_size, "sha256": digest.hexdigest()}
    manifest["metrics"]["export"] = {"wall_time_sec": time.monotonic() - started, "device": "cpu"}
    manifest.update(format="splat", artifact="scene.splat",
                    sha256=manifest["artifact_metadata"]["scene.splat"]["sha256"],
                    bytes=manifest["artifact_metadata"]["scene.splat"]["size_bytes"])
    write_json(root/"run_manifest.json", manifest)
    result = validate_export(root)
    emit(callback, "exporting_splat", 100, "Export structurally validated; visual review remains pending", result)
    return manifest
