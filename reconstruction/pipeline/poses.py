"""Pose backends and a deliberately small COLMAP text-model reader.

References: https://colmap.github.io/format.html and
https://github.com/facebookresearch/vggt (public inference API).
"""
from pathlib import Path
import shutil
import subprocess
import time

import numpy as np
from PIL import Image

from .common import command, emit, executable, write_json


def quaternion_matrix(q):
    q = np.asarray(q, dtype=np.float64)
    if not np.isfinite(q).all() or np.linalg.norm(q) < 1e-12:
        raise ValueError("Invalid camera quaternion")
    w, x, y, z = q / np.linalg.norm(q)
    return np.array([[1 - 2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                     [2*(x*y+z*w), 1 - 2*(x*x+z*z), 2*(y*z-x*w)],
                     [2*(x*z-y*w), 2*(y*z+x*w), 1 - 2*(x*x+y*y)]])


def matrix_quaternion(rotation):
    r = np.asarray(rotation, dtype=np.float64)
    candidates = np.array([1 + np.trace(r), 1 + 2*r[0,0] - np.trace(r),
                           1 + 2*r[1,1] - np.trace(r), 1 + 2*r[2,2] - np.trace(r)])
    i = int(candidates.argmax())
    scale = 2 * np.sqrt(max(candidates[i], 1e-12))
    if i == 0:
        q = [scale/4, (r[2,1]-r[1,2])/scale, (r[0,2]-r[2,0])/scale, (r[1,0]-r[0,1])/scale]
    elif i == 1:
        q = [(r[2,1]-r[1,2])/scale, scale/4, (r[0,1]+r[1,0])/scale, (r[0,2]+r[2,0])/scale]
    elif i == 2:
        q = [(r[0,2]-r[2,0])/scale, (r[0,1]+r[1,0])/scale, scale/4, (r[1,2]+r[2,1])/scale]
    else:
        q = [(r[1,0]-r[0,1])/scale, (r[0,2]+r[2,0])/scale, (r[1,2]+r[2,1])/scale, scale/4]
    q = np.asarray(q)
    return q / np.linalg.norm(q)


def read_model(model_dir, image_dir):
    model_dir, image_dir = Path(model_dir), Path(image_dir)
    cameras = {}
    for line in (model_dir / "cameras.txt").read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        values = line.split()
        camera_id, model, width, height = int(values[0]), values[1], int(values[2]), int(values[3])
        params = list(map(float, values[4:]))
        if model == "PINHOLE":
            fx, fy, cx, cy = params
        elif model == "SIMPLE_PINHOLE":
            fx, cx, cy = params
            fy = fx
        else:
            raise ValueError(f"Training requires undistorted pinhole cameras, got {model}")
        if min(width, height, fx, fy) <= 0 or not np.isfinite(params).all():
            raise ValueError("Invalid camera intrinsics")
        cameras[str(camera_id)] = {"camera_id": camera_id, "model": model, "width": width, "height": height,
                                    "fx": fx, "fy": fy, "cx": cx, "cy": cy}
    lines = (model_dir / "images.txt").read_text().splitlines()
    frames, index = [], 0
    while index < len(lines):
        line = lines[index].strip()
        index += 1
        if not line or line.startswith("#"):
            continue
        values = line.split(maxsplit=9)
        if len(values) != 10:
            raise ValueError("Malformed COLMAP image record")
        image_id, camera_id = int(values[0]), int(values[8])
        q, t = list(map(float, values[1:5])), list(map(float, values[5:8]))
        quaternion_matrix(q)
        if str(camera_id) not in cameras or not np.isfinite(t).all():
            raise ValueError("Image has unknown camera or invalid translation")
        image_path = (image_dir / values[9]).resolve()
        if not image_path.is_relative_to(image_dir.resolve()) or not image_path.is_file():
            raise ValueError(f"Missing or unsafe COLMAP image path: {values[9]}")
        frames.append({"filename": values[9], "frame_id": Path(values[9]).stem, "colmap_image_id": image_id,
                       "camera_id": camera_id, "qvec_wxyz": q, "tvec_xyz": t, "image_path": str(image_path), "status": "registered"})
        # COLMAP always follows each image header with its (possibly empty) POINTS2D line.
        if index >= len(lines):
            raise ValueError("Missing COLMAP POINTS2D line")
        index += 1
    frames.sort(key=lambda f: f["filename"])
    xyz, rgb, errors = [], [], []
    for line in (model_dir / "points3D.txt").read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        values = line.split()
        point, color, error = list(map(float, values[1:4])), list(map(int, values[4:7])), float(values[7])
        if np.isfinite(point).all() and np.isfinite(error):
            xyz.append(point)
            rgb.append(color)
            errors.append(error)
    if len(frames) < 3 or len(xyz) < 4:
        raise ValueError(f"Insufficient reconstruction: {len(frames)} registered frames, {len(xyz)} points")
    return {"cameras": cameras, "frames": frames, "points": np.asarray(xyz, np.float32),
            "colors": np.asarray(rgb, np.uint8), "mean_reprojection_error_px": float(np.mean(errors))}


def _gpu_option(binary, subcommand, old, new, enabled):
    help_text = subprocess.run([executable(binary), subcommand, "-h"], capture_output=True, text=True, timeout=30)
    available = help_text.stdout + help_text.stderr
    key = new if new in available else old
    return ["--" + key, str(int(enabled))]


def sfm_poses(config, backend, callback):
    root = Path(config.output)
    work = root / "poses" / backend
    work.mkdir(parents=True, exist_ok=True)
    database, sparse = work / "database.db", work / "raw_sparse"
    sparse.mkdir(exist_ok=True)
    log = root / "logs" / f"poses_{backend}.log"
    shared = ["--database_path", database]
    command([config.colmap, "feature_extractor", *shared, "--image_path", root / "images",
             "--ImageReader.single_camera", "1", "--ImageReader.camera_model", "SIMPLE_RADIAL",
             *_gpu_option(config.colmap, "feature_extractor", "SiftExtraction.use_gpu", "FeatureExtraction.use_gpu", config.colmap_gpu)], log)
    emit(callback, "estimating_poses", None, f"{backend}: matching image features")
    matching_command = config.matcher + "_matcher"
    command([config.colmap, matching_command, *shared,
             *_gpu_option(config.colmap, matching_command, "SiftMatching.use_gpu", "FeatureMatching.use_gpu", config.colmap_gpu)], log)
    mapper = config.glomap if backend == "glomap" else config.colmap
    mapper_command = "mapper"
    if backend == "glomap" and shutil.which(config.glomap) is None:
        available = subprocess.run([executable(config.colmap), "-h"], capture_output=True, text=True, timeout=30)
        if "global_mapper" not in available.stdout + available.stderr:
            raise RuntimeError("Install GLOMAP or a COLMAP build that exposes global_mapper")
        mapper, mapper_command = config.colmap, "global_mapper"
    command([mapper, mapper_command, *shared, "--image_path", root / "images", "--output_path", sparse], log)
    # Mapper may return disconnected components. Select the one with most registered images.
    candidates = []
    for component in sorted(sparse.iterdir()):
        if not component.is_dir():
            continue
        text_dir = work / f"component_{component.name}"
        text_dir.mkdir(exist_ok=True)
        command([config.colmap, "model_converter", "--input_path", component, "--output_path", text_dir, "--output_type", "TXT"], log)
        lines = (text_dir / "images.txt").read_text().splitlines()
        # POINTS2D lines can be nonempty; count IDs from binary-independent text pairing.
        headers, index = 0, 0
        while index < len(lines):
            if lines[index].strip() and not lines[index].startswith("#"):
                headers += 1
                index += 2
            else:
                index += 1
        candidates.append((headers, component))
    if not candidates:
        raise RuntimeError(f"{backend} did not reconstruct any connected component; inspect {log}")
    selected = max(candidates, key=lambda item: item[0])[1]
    emit(callback, "estimating_poses", None, f"{backend}: undistorting images and cameras")
    command([config.colmap, "image_undistorter", "--image_path", root / "images", "--input_path", selected,
             "--output_path", work, "--output_type", "COLMAP", "--max_image_size", str(config.max_long_side)], log)
    model_dir = work / "sparse" / "0"
    model_dir.mkdir(parents=True, exist_ok=True)
    command([config.colmap, "model_converter", "--input_path", work / "sparse", "--output_path", model_dir, "--output_type", "TXT"], log)
    result = read_model(model_dir, work / "images")
    result["mapper_executable"] = str(mapper)
    result["mapper_command"] = mapper_command
    return result, work


def vggt_poses(config, callback):
    import torch
    from vggt.models.vggt import VGGT
    from vggt.utils.load_fn import load_and_preprocess_images
    from vggt.utils.pose_enc import pose_encoding_to_extri_intri
    from vggt.utils.geometry import unproject_depth_map_to_point_map

    paths = sorted((Path(config.output) / "images").glob("*.jpg"))
    if len(paths) > config.vggt_max_frames:
        raise ValueError(f"VGGT whole-sequence limit {config.vggt_max_frames}; set --max-frames accordingly. No unaligned chunk merging is performed.")
    if not torch.cuda.is_available():
        raise RuntimeError("VGGT requires CUDA in this pipeline")
    torch.cuda.reset_peak_memory_stats(config.device)
    if config.vggt_checkpoint:
        model = VGGT()
        model.load_state_dict(torch.load(config.vggt_checkpoint, map_location="cpu", weights_only=True))
    else:
        model = VGGT.from_pretrained(config.vggt_model)
    model = model.eval().to(config.device)
    images = load_and_preprocess_images([str(p) for p in paths]).to(config.device)
    dtype = torch.bfloat16 if torch.cuda.get_device_capability(config.device)[0] >= 8 else torch.float16
    emit(callback, "estimating_poses", None, "VGGT: inferring cameras and depth for the complete selected sequence")
    with torch.no_grad(), torch.autocast("cuda", dtype=dtype):
        predictions = model(images)
        extrinsics, intrinsics = pose_encoding_to_extri_intri(predictions["pose_enc"], images.shape[-2:])
    ex = extrinsics[0].float().cpu().numpy()
    ks = intrinsics[0].float().cpu().numpy()
    depth = predictions["depth"][0].float().cpu().numpy()
    confidence = predictions["depth_conf"][0].float().cpu().numpy()
    points = unproject_depth_map_to_point_map(depth, ex, ks)
    pixels = images.permute(0, 2, 3, 1).float().cpu().numpy()
    good = np.isfinite(points).all(axis=-1) & np.isfinite(confidence) & (depth[..., 0] > 0)
    if not good.any():
        raise RuntimeError("VGGT returned no finite depth points")
    good &= confidence >= np.quantile(confidence[good], 0.7)
    flat_ids = np.flatnonzero(good)
    rng = np.random.default_rng(config.seed)
    if len(flat_ids) > config.initial_points:
        flat_ids = rng.choice(flat_ids, config.initial_points, replace=False)
    xyz = points.reshape(-1, 3)[flat_ids]
    rgb = np.clip(pixels.reshape(-1, 3)[flat_ids] * 255, 0, 255).astype(np.uint8)
    work = Path(config.output) / "poses" / "vggt"
    image_dir, model_dir = work / "images", work / "sparse" / "0"
    image_dir.mkdir(parents=True, exist_ok=True)
    model_dir.mkdir(parents=True, exist_ok=True)
    height, width = pixels.shape[1:3]
    camera_lines, image_lines = [], []
    for i, (path, k, extrinsic) in enumerate(zip(paths, ks, ex), 1):
        # Save exactly the preprocessed images paired with predicted intrinsics, avoiding crop/resize mismatch.
        Image.fromarray(np.clip(pixels[i-1]*255, 0, 255).astype(np.uint8)).save(image_dir / path.name)
        camera_lines.append(f"{i} PINHOLE {width} {height} {k[0,0]} {k[1,1]} {k[0,2]} {k[1,2]}")
        q = matrix_quaternion(extrinsic[:3, :3])
        image_lines.append(f"{i} " + " ".join(map(str, [*q, *extrinsic[:3, 3], i])) + f" {path.name}\n")
    (model_dir / "cameras.txt").write_text("\n".join(camera_lines) + "\n")
    (model_dir / "images.txt").write_text("\n".join(image_lines) + "\n")
    (model_dir / "points3D.txt").write_text("\n".join(f"{i} " + " ".join(map(str, [*p, *c, 0])) for i, (p, c) in enumerate(zip(xyz, rgb), 1)) + "\n")
    peak = torch.cuda.max_memory_allocated(config.device) / 1024**3
    del model, predictions, images, extrinsics, intrinsics
    torch.cuda.empty_cache()
    model = read_model(model_dir, image_dir)
    # Depth initialization has no feature tracks; do not invent a reprojection error.
    model["mean_reprojection_error_px"] = None
    model["peak_torch_vram_gb"] = peak
    model["vggt_checkpoint"] = config.vggt_checkpoint or config.vggt_model
    model["vggt_code_revision"] = config.vggt_code_revision
    return model, work


def estimate_poses(config, extraction, callback=None):
    selected, reports = None, []
    backends = list(dict.fromkeys([config.pose_estimator, *(["glomap", "vggt"] if config.compare_poses else [])]))
    for backend in backends:
        started = time.monotonic()
        emit(callback, "estimating_poses", None, f"Starting {backend} pose estimation")
        try:
            model, work = vggt_poses(config, callback) if backend == "vggt" else sfm_poses(config, backend, callback)
            metrics = {"backend": backend, "registered_frames": len(model["frames"]), "input_frames": extraction["metrics"]["extracted_frames"],
                       "registered_fraction": len(model["frames"]) / extraction["metrics"]["extracted_frames"], "sparse_points": len(model["points"]),
                       "mean_reprojection_error_px": model["mean_reprojection_error_px"], "wall_time_sec": time.monotonic() - started,
                       "peak_torch_vram_gb": model.get("peak_torch_vram_gb"),
                       "pose_device": config.device if backend == "vggt" or config.colmap_gpu else "cpu",
                       "matcher": config.matcher if backend != "vggt" else None, "visual_review": "pending"}
            model["metrics"] = metrics
            model["work_dir"] = str(work)
            np.savez_compressed(work / "sparse_points.npz", xyz=model["points"], rgb=model["colors"])
            metadata = {k: v for k, v in model.items() if k not in {"points", "colors"}}
            write_json(work / "poses.json", metadata)
            reports.append({"status": "completed", **metrics})
            if backend == config.pose_estimator:
                selected = model
        except Exception as error:
            reports.append({"backend": backend, "status": "failed", "error": str(error), "wall_time_sec": time.monotonic() - started})
            if backend == config.pose_estimator:
                write_json(Path(config.output) / "pose_comparison.json", {"candidates": reports})
                raise
    write_json(Path(config.output) / "pose_comparison.json", {"candidates": reports, "selected_backend": config.pose_estimator,
               "selection_reason": "Explicit configuration; compare visual quality before changing this selection.",
               "same_input_frame_ids": [f["frame_id"] for f in extraction["frames"] if f["status"] != "dropped"]})
    emit(callback, "estimating_poses", 100, "Pose estimation complete", selected["metrics"])
    return selected
