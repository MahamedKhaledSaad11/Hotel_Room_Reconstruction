# Backend handoff

Each input video creates a scene-specific set of trained Gaussians. The reusable service is the Python pipeline and notebook. A completed job supplies the scene asset and its camera metadata to the backend.

## Install and verify

Clone the repository and run commands from its root. Use Python 3.11+ on the backend host. This host dispatches Kaggle jobs and does not need a local CUDA GPU.

```sh
python -m pip install -r reconstruction/requirements-bridge.txt
kaggle kernels list --mine --page-size 1
python -m reconstruction.bridge --open
```

Configure your own Kaggle account with the [official authentication instructions](https://github.com/Kaggle/kaggle-cli/blob/main/docs/authentication.md), enable Internet for notebooks and ensure the account has access to a T4. Keep credentials in the deployment's secret storage. Each attempt creates a private dataset and notebook in that account. Input upload and notebook initialization can take several minutes before reconstruction begins.

## Call from your job worker

Run submission, polling and collection in a durable background worker. Persist the returned identifiers in your job record. These operations block while calling the Kaggle CLI, so keep them outside the FastAPI request handler.

```python
from pathlib import Path
from reconstruction.kaggle.private import PrivateDispatcher

dispatcher = PrivateDispatcher(
    dispatch_root=Path("/data/reconstruction-dispatches"),
    pose_estimator="glomap",
)

# First save the uploaded video to a durable path.
job = dispatcher.submit_video(Path("/data/uploads/room.mp4"))
# Persist job["kernel_ref"] and job["dataset_ref"] against your task ID.

# Poll from the worker, approximately once per minute.
state = dispatcher.status(job["kernel_ref"])
if state["status"] == "running":
    progress = dispatcher.last_progress(job["kernel_ref"])
    # Save stage, progress and message if progress is available.
elif state["status"] == "complete":
    directory = dispatcher.collect(job["kernel_ref"], Path("/data/results/task-001"))
    # directory contains scene.splat and run_manifest.json.
elif state["status"] == "failed":
    # Mark your task as failed and retain the kernel reference for diagnosis.
    pass
```

Before declaring a task ready, verify both downloaded files. The bridge demonstrates the same validation.

```python
import json
from reconstruction.bridge.store import validate_splat, verify_manifest

artifact = validate_splat(directory / "scene.splat")
manifest = json.loads((directory / "run_manifest.json").read_text(encoding="utf-8"))
verify_manifest(manifest, artifact)
```

Kaggle status values returned by this adapter are `queued`, `running`, `complete`, `failed` and `unknown`. Log access may temporarily return an empty progress dictionary. Preserve the previous reported stage while waiting. A network error during output retrieval can be retried against the same kernel. An ambiguous submission should be checked in Kaggle before creating another job.

The reference bridge implements restart recovery and output download retries in [bridge/app.py](bridge/app.py). Its HTTP endpoints are for the local test tool. Your backend can call the dispatcher directly and expose its existing API.

## Progress and direct GPU execution

On a prepared Linux CUDA worker, the same pipeline runs directly.

```sh
python -m reconstruction.pipeline --video /data/uploads/room.mp4 --output /data/results/task-001 --pose-estimator glomap
```

Use a fresh output directory per attempt. The notebook's [environment setup](kaggle/setup_environment.py) installs the tested COLMAP/GLOMAP and PyTorch/gsplat environments, and verifies CUDA rasterization. This setup targets Kaggle T4. A rented GPU requires an environment suitable for that GPU.

Pipeline stdout is JSON Lines. Stderr contains diagnostics. An example event is

```json
{"event":"progress","stage":"training_3dgs","progress":50,"message":"Training iteration 3500/7000","metrics":{"iterations_done":3500,"iterations_total":7000}}
```

Stages are `extracting_frames`, `estimating_poses`, `training_3dgs` and `exporting_splat`. Percentages are local to the stage. A null percentage means the stage has no reliable numeric progress. A zero process exit and a `completed` event with `partial: false` indicate a full export. Diagnostic runs using `--stop-after` can finish with `partial: true`.

## Serve the result to the frontend

Upload the verified scene to your persistent file or object storage and return its URL through your existing scene endpoint. Serve the JSON manifest through the same project. Configure CORS when the viewer fetches assets from another origin.

The manifest contains `viewer_transform`, `initial_camera`, `cameras`, `frames`, `gaussian_count` and `metrics`. It includes the splat's SHA-256 and byte count. Gaussian positions remain in COLMAP coordinates. Apply `viewer_transform.colmap_to_threejs_matrix` once when loading. The initial camera and scene bounds are already in viewer coordinates. SfM scale is arbitrary.

The frontend mapping currently lives in [api.ts](../frontend/src/services/api.ts). Reuse its scene DTO and the existing splat loader. The local [viewer](viewer/) accepts your downloaded output directory.

```sh
cd frontend
npm install
cd ..
python -m reconstruction.viewer --run /data/results/task-001/run --open
node reconstruction/check_viewer.mjs /data/results/task-001/run
```

Use the actual directory returned by `collect` in these commands. The notebook also provides full PLY, intermediate camera data, training metrics and evaluation renders in its Kaggle output. `collect` downloads the compact scene and manifest.

## Reproduce the notebook and tests

The committed notebook embeds a snapshot of the pipeline sources. Regenerate it after pipeline changes.

```sh
python -m reconstruction.kaggle.launcher --pose-estimator glomap --build-only reconstruction/kaggle/reconstruction.ipynb
python -m pip install -r reconstruction/requirements-dev.txt
python -m pytest -q reconstruction/tests
```

The tests use temporary files and fake remote dispatchers, including local HTTP. The FFmpeg extraction test runs when working FFmpeg and ffprobe executables are on PATH. Test measurements and known image quality limitations are recorded in [VALIDATION.md](VALIDATION.md). Source videos and run outputs are supplied separately by the operator.
