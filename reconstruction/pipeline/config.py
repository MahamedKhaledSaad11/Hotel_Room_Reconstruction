from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass
class PipelineConfig:
    video: str
    output: str
    pose_estimator: str = "colmap"
    fps: float = 2.0
    max_long_side: int = 960
    max_frames: int | None = None
    drop_blurry: bool = False
    blur_threshold: float = 35.0
    holdout_every: int = 8
    iterations: int = 7000
    seed: int = 42
    device: str = "cuda"
    max_gaussians: int = 1_000_000
    initial_points: int = 100_000
    sh_degree: int = 3
    compare_poses: bool = False
    vggt_model: str = "facebook/VGGT-1B"
    vggt_checkpoint: str | None = None
    vggt_code_revision: str = "installed-package"
    vggt_max_frames: int = 32
    ffmpeg: str = "ffmpeg"
    ffprobe: str = "ffprobe"
    colmap: str = "colmap"
    glomap: str = "glomap"
    colmap_gpu: bool = False
    matcher: str = "sequential"
    stop_after: str = "export"
    stage: str = "all"
    resume: bool = False

    def validate(self):
        self.video = str(Path(self.video).resolve())
        self.output = str(Path(self.output).resolve())
        if not Path(self.video).is_file():
            raise ValueError(f"Video does not exist: {self.video}")
        if self.pose_estimator not in {"colmap", "glomap", "vggt"}:
            raise ValueError("pose_estimator must be colmap, glomap, or vggt")
        if not 0 < self.fps <= 30 or not 64 <= self.max_long_side <= 1920:
            raise ValueError("fps must be in (0,30], max_long_side in [64,1920]")
        if self.max_frames is not None and self.max_frames < 3:
            raise ValueError("max_frames must be at least 3")
        if self.holdout_every < 2 or self.iterations < 1 or self.initial_points < 4:
            raise ValueError("holdout_every >= 2, iterations >= 1, initial_points >= 4 required")
        if self.max_gaussians < self.initial_points or self.sh_degree not in range(4):
            raise ValueError("max_gaussians >= initial_points and sh_degree in 0..3 required")
        if self.device != "cuda" and not self.device.startswith("cuda:"):
            raise ValueError("gsplat training requires a CUDA device")
        if self.stop_after not in {"extract", "poses", "train", "export"}:
            raise ValueError("Unknown stop_after stage")
        if self.stage not in {"all", "extract", "poses", "train", "export"}:
            raise ValueError("Unknown stage")
        if self.matcher not in {"sequential", "exhaustive"}:
            raise ValueError("matcher must be sequential or exhaustive")
        if self.blur_threshold < 0 or self.vggt_max_frames < 3:
            raise ValueError("Invalid blur_threshold or vggt_max_frames")
        if self.compare_poses and (self.max_frames is None or self.max_frames > self.vggt_max_frames):
            raise ValueError("Comparison uses identical frames; set --max-frames <= --vggt-max-frames")
        return self

    def serializable(self):
        return asdict(self)
