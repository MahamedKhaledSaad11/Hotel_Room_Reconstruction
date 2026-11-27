# Room video reconstruction

The model takes a video and a fresh output directory. The notebook runs the model on a CUDA GPU. A separate local page uploads a video to the operator's Kaggle account, reports actual job progress, and retrieves the scene. All three entry points use the same pipeline.

Backend integration starts with [INTEGRATION.md](INTEGRATION.md), including dispatch, progress, output verification and frontend asset mapping.

## Start the upload page

From the repository root, use Python 3.11+ with an authenticated Kaggle CLI, access to a T4 and notebook Internet access. Keep the local process running while uploading or retrieving results.

```powershell
python -m pip install -r reconstruction/requirements-bridge.txt
kaggle kernels list --mine --page-size 1
python -m reconstruction.bridge --open
```

Select a video and press **Upload and reconstruct**. The default transport creates one private input dataset and one private notebook for the attempt. The operator page is bound to loopback. It polls Kaggle for status and available training events, then downloads and verifies the splat and manifest. Kaggle retains its copies in your account. Refreshing the page recovers the latest run from disk. If the browser does not open, use the private local URL printed by the command. [Kaggle authentication](https://github.com/Kaggle/kaggle-cli/blob/main/docs/authentication.md) · [Bridge endpoints and recovery](bridge/README.md)

## Run the notebook directly

To explore the locally generated scenes in the browser, run the command below. Select Video 0 or Video 1 at the top. Drag inside the scene to look around, use W/A/S/D or the arrow keys to move and Q/E to move vertically. These use the physical key positions with either an Arabic or English keyboard layout. Alternatively, hold the movement buttons in the lower left with a mouse or touch. The speed slider adjusts movement and Return to start restores the original camera. To open another output, pass its directory using `--run`.

```powershell
python -m reconstruction.viewer --run PATH_TO_DOWNLOADED_RUN --open
```

Upload [reconstruction.ipynb](kaggle/reconstruction.ipynb) as a private Kaggle notebook. Attach the video as an input, select a T4 and enable Internet. In the configuration cell, set `VIDEO_PATH` to a file path or a unique filename among the attached inputs. Run all cells. The environment bootstrap verifies a real CUDA rasterization and backward pass before training. Download the scene from the notebook output under `run/`.

The notebook embeds a snapshot of the Python sources so it can run on its own. Regenerate it after changing the pipeline or worker. To run the pose comparison on a uniform sample spanning the video, build a separate experimental notebook.

```powershell
python -m reconstruction.kaggle.launcher --pose-estimator glomap --build-only reconstruction/kaggle/reconstruction.ipynb
python -m reconstruction.kaggle.launcher --pose-estimator glomap --build-only reconstruction/runs/compare.ipynb --compare-poses --max-frames 32 --stop-after poses
```

The comparison runs GLOMAP and VGGT on the same sampled frames. Review their coverage, sparse geometry and resources in `pose_comparison.json`. VGGT supports an explicit checkpoint and a bounded frame count. Select weights appropriate to the intended use. [COLMAP](https://colmap.github.io/tutorial.html) · [VGGT weights and code](https://github.com/facebookresearch/vggt) · [gsplat](https://github.com/nerfstudio-project/gsplat)

## Interface for backend integration

```sh
python -m reconstruction.pipeline --video /data/room.mp4 --output /jobs/room-001 --pose-estimator glomap
```

The process emits JSON objects on stdout, one per line. A `progress` event includes `stage`, a stage-local percentage or `null`, a human-readable `message`, and `metrics`. Training events report completed and total iterations. A nonzero exit signals failure. Publish a scene only after a full `completed` event with `partial: false` and verified artifacts. `--stop-after poses` emits a partial completion for diagnostics. Use a fresh directory for changed settings and `--resume` for compatible completed stages. [CLI](pipeline/__main__.py)

| Run output | Purpose |
| --- | --- |
| `images/`, `extraction.json` | Sampled images, source hash, frame timestamps and retention decisions |
| `poses/<estimator>/` | Camera intrinsics and poses, sparse points and the images aligned with those intrinsics |
| `evaluation/`, `training_metrics.json` | Reference and rendered images for held-out views, PSNR, SSIM, training time and peak allocated GPU memory |
| `scene.splat`, `run_manifest.json` | Viewer asset, checksum, cameras, bounds and initial pose |
| `scene.ply`, `sparse_points.ply`, `checkpoint.npz` | Full trained parameters and geometry for inspection |

The bridge downloads the two viewer files. The notebook also retains the intermediate data in its output. Model coordinates use arbitrary SfM scale. The compact splat stores view-independent color, so evaluate the exported scene separately from the training renders.

## Acceptance

1. Develop on `Video_0.mp4`. Compare the shelves and fabric detail in the held-out render/reference pairs. The registered poses may use all frames. Held-out images do not enter the Gaussian training loss.
2. Freeze settings and upload `Video_1.mp4` through the operator page. Verify its newly computed output with Node 24+ and the existing frontend dependencies installed.

   ```sh
   node reconstruction/check_viewer.mjs PATH_TO_DIRECTORY_WITH_SCENE_AND_MANIFEST
   ```

   The check exercises the project's actual Three.js loader, camera conversions and splat mesh creation. Interactive image quality and movement through doorways are separate visual checks.
3. Test an interrupted upload, remote failure, retry and page refresh. Run the component and integration suite with `python -m pytest -q reconstruction/tests`. The bridge tests use loopback and isolated temporary storage. For the FFmpeg extraction test, put working `ffmpeg` and `ffprobe` on PATH.
4. When suite footage is available, walk from its entrance through every filmed doorway on a continuous scene and record hotel acceptance. The two sample clips cover an interior display and an exterior building.
