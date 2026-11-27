import json
from pathlib import Path
import time

import numpy as np

from .common import emit, write_json
from .config import PipelineConfig
from .extract import extract_frames
from .poses import estimate_poses
from .train import train_gaussians
from .export import export_scene

STAGES = [("extract", "extracting_frames"), ("poses", "estimating_poses"), ("train", "training_3dgs"), ("export", "exporting_splat")]


def load_poses(config):
    work = Path(config.output)/"poses"/config.pose_estimator
    model = json.loads((work/"poses.json").read_text(encoding="utf-8"))
    with np.load(work/"sparse_points.npz", allow_pickle=False) as data:
        model["points"], model["colors"] = data["xyz"], data["rgb"]
    return model


def _identity(config):
    result = config.serializable()
    for key in ["resume", "stop_after", "stage"]:
        result.pop(key)
    stat = Path(config.video).stat()
    result["source_file_size"] = stat.st_size
    result["source_file_mtime_ns"] = stat.st_mtime_ns
    return result


def run_pipeline(config: PipelineConfig, event_callback=None):
    """Execute selected stages. Completed stages may be reused only with matching --resume config.

    Return the export manifest for a full run, otherwise a partial result descriptor.
    Event callbacks receive JSON-serializable dictionaries; exceptions propagate after a failed event.
    """
    config.validate()
    root = Path(config.output)
    root.mkdir(parents=True, exist_ok=True)
    identity = _identity(config)
    record = root/"pipeline_config.json"
    if record.exists():
        if not config.resume and config.stage == "all":
            raise ValueError("Output already belongs to a run; pass --resume with matching settings or choose a fresh output")
        if json.loads(record.read_text(encoding="utf-8")) != identity:
            raise ValueError("Resume configuration/source changed. Use a fresh output directory for a different experiment.")
    elif any(root.iterdir()):
        raise ValueError("Output directory is nonempty and has no pipeline_config.json; choose a fresh directory")
    else:
        write_json(record, identity)
    started = time.monotonic()
    extraction, model, arrays, training_metrics, manifest = None, None, None, None, None
    last_stage = "extracting_frames"
    try:
        for name, stage_id in STAGES:
            if config.stage != "all" and name != config.stage:
                continue
            last_stage = stage_id
            emit(event_callback, stage_id, None, f"Starting {name}")
            if name == "extract":
                if config.resume and (root/"extraction.json").is_file():
                    extraction = json.loads((root/"extraction.json").read_text(encoding="utf-8"))
                    emit(event_callback, stage_id, 100, "Reusing completed frame extraction", extraction["metrics"])
                else:
                    extraction = extract_frames(config, event_callback)
            elif name == "poses":
                extraction = extraction or json.loads((root/"extraction.json").read_text(encoding="utf-8"))
                if config.resume and (root/"poses"/config.pose_estimator/"poses.json").is_file():
                    model = load_poses(config)
                    emit(event_callback, stage_id, 100, "Reusing completed pose estimation", model["metrics"])
                else:
                    model = estimate_poses(config, extraction, event_callback)
            elif name == "train":
                model = model or load_poses(config)
                if config.resume and (root/"training_metrics.json").is_file() and (root/"checkpoint.npz").is_file():
                    training_metrics = json.loads((root/"training_metrics.json").read_text(encoding="utf-8"))
                    with np.load(root/"checkpoint.npz", allow_pickle=False) as data:
                        arrays = dict(data)
                    emit(event_callback, stage_id, 100, "Reusing completed Gaussian training", {"iterations_done": training_metrics["iterations_done"]})
                else:
                    arrays, training_metrics = train_gaussians(config, model, event_callback)
            elif name == "export":
                extraction = extraction or json.loads((root/"extraction.json").read_text(encoding="utf-8"))
                model = model or load_poses(config)
                if arrays is None:
                    with np.load(root/"checkpoint.npz", allow_pickle=False) as data:
                        arrays = dict(data)
                training_metrics = training_metrics or json.loads((root/"training_metrics.json").read_text(encoding="utf-8"))
                manifest = export_scene(config, extraction, model, arrays, training_metrics, event_callback)
            if name == config.stop_after and config.stage == "all":
                break
        result = manifest or {"partial": True, "stopped_after": name, "output": str(root)}
        emit(event_callback, last_stage, 100, "Pipeline completed" if manifest else f"Requested stage complete: {name}",
             {"wall_time_sec": time.monotonic()-started}, event="completed", output=str(root),
             manifest_path=str(root/"run_manifest.json") if manifest else None,
             artifacts=manifest["artifacts"] if manifest else {}, partial=manifest is None)
        return result
    except Exception as error:
        emit(event_callback, last_stage, None, str(error), {"wall_time_sec": time.monotonic()-started}, event="failed", error=str(error))
        raise
