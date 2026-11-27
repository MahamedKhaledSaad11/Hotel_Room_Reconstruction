import argparse
import contextlib
import json
import sys

from .common import emit
from .config import PipelineConfig
from .runner import run_pipeline


def parser():
    p = argparse.ArgumentParser(description="Real video -> poses -> CUDA gsplat -> viewer-compatible export; stdout is JSONL")
    p.add_argument("--video", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--pose-estimator", choices=["colmap", "glomap", "vggt"], default="colmap")
    p.add_argument("--fps", type=float, default=2)
    p.add_argument("--max-long-side", type=int, default=960)
    p.add_argument("--max-frames", type=int)
    p.add_argument("--drop-blurry", action="store_true")
    p.add_argument("--blur-threshold", type=float, default=35)
    p.add_argument("--holdout-every", type=int, default=8)
    p.add_argument("--iterations", type=int, default=7000)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--device", default="cuda")
    p.add_argument("--max-gaussians", type=int, default=1_000_000)
    p.add_argument("--initial-points", type=int, default=100_000)
    p.add_argument("--sh-degree", type=int, default=3)
    p.add_argument("--compare-poses", action="store_true")
    p.add_argument("--vggt-model", default="facebook/VGGT-1B")
    p.add_argument("--vggt-checkpoint")
    p.add_argument("--vggt-code-revision", default="installed-package")
    p.add_argument("--vggt-max-frames", type=int, default=32)
    for name in ["ffmpeg", "ffprobe", "colmap", "glomap"]:
        p.add_argument("--" + name, default=name)
    p.add_argument("--colmap-gpu", action="store_true", help="Default is CPU feature extraction/matching for portable COLMAP builds")
    p.add_argument("--matcher", choices=["sequential", "exhaustive"], default="sequential")
    p.add_argument("--stop-after", choices=["extract", "poses", "train", "export"], default="export")
    p.add_argument("--stage", choices=["all", "extract", "poses", "train", "export"], default="all", help="A single stage requires completed predecessor artifacts")
    p.add_argument("--resume", action="store_true", help="Reuse completed stages with identical config/source; partial training restarts")
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    stdout = sys.stdout
    failure_emitted = False
    def event(item):
        nonlocal failure_emitted
        failure_emitted = failure_emitted or item["event"] == "failed"
        stdout.write(json.dumps(item, allow_nan=False) + "\n")
        stdout.flush()
    try:
        # CUDA extensions and model libraries sometimes print. Reserve stdout for our protocol.
        with contextlib.redirect_stdout(sys.stderr):
            run_pipeline(PipelineConfig(**vars(args)), event_callback=event)
        return 0
    except Exception as error:
        # Validation failures occur before the runner emits its first stage event.
        print(f"Pipeline error: {error}", file=sys.stderr)
        if not failure_emitted:
            emit(event, "extracting_frames", None, str(error), event="failed", error=str(error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
