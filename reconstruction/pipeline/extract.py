import hashlib
import json
from pathlib import Path
import subprocess
import time

import numpy as np
from PIL import Image

from .common import command, emit, executable, write_json


def blur_score(image):
    gray = np.asarray(image.convert("L"), dtype=np.float32)
    # Discrete four-neighbour Laplacian, excluding the padded border.
    lap = gray[:-2, 1:-1] + gray[2:, 1:-1] + gray[1:-1, :-2] + gray[1:-1, 2:] - 4 * gray[1:-1, 1:-1]
    return float(lap.var())


def probe_video(config):
    result = subprocess.run([executable(config.ffprobe), "-v", "error", "-select_streams", "v:0",
                             "-show_entries", "stream=width,height,avg_frame_rate,duration:format=duration",
                             "-of", "json", config.video], capture_output=True, text=True, check=True, timeout=60)
    raw = json.loads(result.stdout)
    if not raw.get("streams"):
        raise ValueError("Input has no readable video stream")
    stream = raw["streams"][0]
    duration = float(stream.get("duration", raw.get("format", {}).get("duration", 0)))
    if duration <= 0 or int(stream["width"]) <= 0 or int(stream["height"]) <= 0:
        raise ValueError("Video has invalid dimensions or duration")
    rate = stream.get("avg_frame_rate", "0/1").split("/")
    source_fps = float(rate[0]) / float(rate[1]) if len(rate) == 2 and float(rate[1]) else 0
    digest = hashlib.sha256()
    with open(config.video, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return {"filename": Path(config.video).name, "sha256": digest.hexdigest(), "size_bytes": Path(config.video).stat().st_size,
            "duration_sec": duration, "source_fps": source_fps, "width": int(stream["width"]), "height": int(stream["height"])}


def extract_frames(config, callback=None):
    started = time.monotonic()
    root = Path(config.output)
    target = root / "images"
    target.mkdir(parents=True, exist_ok=True)
    if any(target.iterdir()):
        raise ValueError("Extraction target already contains images; use a fresh output directory")
    source = probe_video(config)
    emit(callback, "extracting_frames", None, "Decoding sampled frames with FFmpeg", source)
    side = config.max_long_side
    # FFmpeg autorotation is enabled; resize preserves display aspect and never upscales.
    scale = f"scale=w='trunc(iw*min(1,{side}/max(iw,ih))/2)*2':h='trunc(ih*min(1,{side}/max(iw,ih))/2)*2'"
    args = [config.ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "warning", "-i", config.video,
            "-vf", f"fps={config.fps},{scale}", "-q:v", "2", "-start_number", "0", str(target / "frame_%06d.jpg")]
    if config.max_frames is not None:
        # Select uniformly over the entire video, rather than taking only its beginning.
        sample_fps = min(config.fps, config.max_frames / source["duration_sec"])
        args[args.index("-vf") + 1] = f"fps={sample_fps},{scale}"
        args[-1:-1] = ["-frames:v", str(config.max_frames)]
    else:
        sample_fps = config.fps
    command(args, root / "logs" / "extract.log")
    frames = []
    for index, path in enumerate(sorted(target.glob("frame_*.jpg"))):
        with Image.open(path) as image:
            width, height = image.size
            score = blur_score(image)
        dropped = config.drop_blurry and score < config.blur_threshold
        frame = {"frame_id": path.stem, "index": index, "timestamp_sec": (index + 0.5) / sample_fps,
                 "image_relative_path": str(path.relative_to(root)).replace("\\", "/"), "filename": path.name,
                 "width": width, "height": height, "blur_score": score,
                 "status": "dropped" if dropped else "extracted", "dropped_reason": "blurry" if dropped else None}
        if dropped:
            dropped_dir = root / "dropped_images"
            dropped_dir.mkdir(exist_ok=True)
            path.rename(dropped_dir / path.name)
            frame["image_relative_path"] = f"dropped_images/{path.name}"
        frames.append(frame)
    retained = sum(frame["status"] == "extracted" for frame in frames)
    if retained < 3:
        raise ValueError(f"Only {retained} usable frames; at least three required. Adjust sampling/blur threshold.")
    result = {"source": source, "sample_fps": sample_fps, "frames": frames,
              "metrics": {"sampled_frames": len(frames), "extracted_frames": retained, "dropped_frames": len(frames) - retained,
                          "wall_time_sec": time.monotonic()-started}}
    write_json(root / "extraction.json", result)
    emit(callback, "extracting_frames", 100, "Frame extraction complete", result["metrics"])
    return result
