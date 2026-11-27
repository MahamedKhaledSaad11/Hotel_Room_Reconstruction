import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image
import pytest

from reconstruction.pipeline import PipelineConfig, run_pipeline
from reconstruction.pipeline.extract import blur_score


def ffmpeg_binaries():
    candidate = Path("C:/Users/Mohamed/miniconda3/envs/torch_gpu/Library/bin")
    ffmpeg, ffprobe = os.environ.get("FFMPEG_BINARY") or shutil.which("ffmpeg"), os.environ.get("FFPROBE_BINARY") or shutil.which("ffprobe")
    if not ffmpeg and (candidate/"ffmpeg.exe").is_file():
        ffmpeg = str(candidate/"ffmpeg.exe")
    if not ffprobe and (candidate/"ffprobe.exe").is_file():
        ffprobe = str(candidate/"ffprobe.exe")
    if not ffmpeg or not ffprobe:
        pytest.skip("FFmpeg/ffprobe not installed")
    for binary in [ffmpeg, ffprobe]:
        if subprocess.run([binary, "-version"], capture_output=True).returncode:
            pytest.skip(f"Installed {Path(binary).name} cannot start; set FFMPEG_BINARY/FFPROBE_BINARY to working static binaries")
    return ffmpeg, ffprobe


def test_blur_filter_detects_lost_detail():
    solid = Image.new("L", (64, 64), 128)
    checker = Image.fromarray((np.indices((64,64)).sum(axis=0)%2*255).astype(np.uint8))
    assert blur_score(solid) == 0
    assert blur_score(checker) > 1000


def test_actual_ffmpeg_extract_full_video_sampling_and_resume(tmp_path):
    ffmpeg, ffprobe = ffmpeg_binaries()
    video = tmp_path/"input video.mp4"
    subprocess.run([ffmpeg, "-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=12",
                    "-t", "4", "-c:v", "mpeg4", "-q:v", "2", str(video)], check=True)
    events = []
    config = PipelineConfig(str(video), str(tmp_path/"run"), fps=3, max_frames=4, max_long_side=128,
                            ffmpeg=ffmpeg, ffprobe=ffprobe, stop_after="extract")
    result = run_pipeline(config, events.append)
    assert result["partial"]
    extraction = json.loads((tmp_path/"run"/"extraction.json").read_text())
    assert extraction["metrics"]["extracted_frames"] == 4
    assert extraction["sample_fps"] == 1
    assert extraction["frames"][-1]["timestamp_sec"] == 3.5
    assert all(max(f["width"], f["height"]) <= 128 for f in extraction["frames"])
    assert events[-1]["event"] == "completed" and events[-1]["partial"]
    assert all(e["stage"] == "extracting_frames" for e in events)
    config.resume = True
    assert run_pipeline(config)["partial"]
    config.fps = 2
    with pytest.raises(ValueError, match="configuration/source changed"):
        run_pipeline(config)


def test_cli_failure_is_one_jsonl_event_and_nonzero(tmp_path):
    result = subprocess.run([sys.executable, "-m", "reconstruction.pipeline", "--video", str(tmp_path/"missing.mp4"),
                             "--output", str(tmp_path/"run")], capture_output=True, text=True)
    assert result.returncode != 0
    events = [json.loads(line) for line in result.stdout.splitlines()]
    assert len(events) == 1
    assert events[0]["event"] == "failed"
    assert "does not exist" in events[0]["error"]


def test_comparison_refuses_unequal_frame_sets(tmp_path):
    source = tmp_path/"video.mp4"
    source.touch()
    config = PipelineConfig(str(source), str(tmp_path/"run"), compare_poses=True)
    with pytest.raises(ValueError, match="identical frames"):
        config.validate()
