# Development validation

The first full Kaggle run used Video_0.mp4, GLOMAP with sequential matching, 2 sampled frames per second, a 960-pixel long side and 7,000 Gaussian optimization iterations.

| Measurement | Observed value |
| --- | --- |
| Registered cameras | 123 / 123 |
| Sparse points | 24,643 |
| Mean reprojection error | 0.626 pixels |
| Pose estimation | 224.39 seconds, CPU |
| Gaussian training | 377.39 seconds, Tesla T4 |
| Peak PyTorch allocated VRAM during training | 0.806 GiB |
| Exported Gaussians | 485,850 |
| Splat size | 15,547,200 bytes |
| Held-out PSNR | 26.146 dB |
| Held-out SSIM with box11 implementation | 0.9218 |

These image metrics evaluate full SH training renders. The compact splat retains DC color. A visual check of a held-out reference/render pair shows recovered shelves, fabric patterns and dishes, with blurred small printed text and local floating artifacts. The actual frontend loader successfully parses the scene and its cameras and creates its splat mesh. A headless browser renders the scene through the existing viewport. That inspection also exposes noise around the captured area and incomplete geometry beyond it. Visual hotel acceptance remains pending.

The pose experiment used the same 32 uniformly sampled frames for both methods.

| Method | Views reported | Time | Peak allocated torch VRAM |
| --- | --- | --- | --- |
| GLOMAP, CPU | 32 / 32 registered | 38.10 seconds | CPU |
| VGGT, T4 | 32 / 32 predicted | 77.61 seconds including weights loading | 8.77 GiB |

GLOMAP is the current default because its camera estimates support the demonstrated trained/exported result. VGGT camera predictions and registration counts measure different operations. This experiment does not establish a final visual quality winner.

Artifacts and reports are in the ignored local directory runs/video0-kaggle/run and runs/comparison/run. The samples originate from [DL3DV](https://huggingface.co/datasets/DL3DV/DL3DV-10K-Sample). The implementation follows the [gsplat rasterization API](https://github.com/nerfstudio-project/gsplat) and [COLMAP capture guidance](https://colmap.github.io/tutorial.html#structure-from-motion).

The second scene was submitted through the local browser page using Video_1.mp4 and the same model configuration. After the upload finished, reloading the page recovered the run. The private Kaggle notebook completed, the bridge retrieved both files and validated their hashes, and the page showed its completed state with download links.

| Independent Video_1 run | Observed value |
| --- | --- |
| Registered cameras | 141 / 141 sampled frames |
| Sparse points | 31,525 |
| Mean reprojection error | 0.673 pixels |
| Pose estimation | 367.70 seconds, CPU |
| Gaussian training | 359.71 seconds, Tesla T4 |
| Peak PyTorch allocated VRAM during training | 0.821 GiB |
| Exported Gaussians | 489,941 |
| Splat size | 15,678,112 bytes |
| Held-out PSNR | 21.307 dB |
| Held-out SSIM with box11 implementation | 0.8523 |

The actual Three.js loader also passed on this downloaded scene. Its local artifacts are in runs/bridge/9819a66550fc4893bd00385b195a83fe. The dataset copy uses a standard input filename; its original operator filename is Video_1.mp4 and its SHA-256 is e5423384958812ba06755f99ef1ed05ddbb28793c4b8a3c142928608d960c087.

The final Python suite passed 48 tests and seven parametrized subtests, including real local HTTP, interrupted upload, retry token invalidation, result corruption and restart recovery. The first deliberately interrupted browser upload remains recorded as failed. The subsequent complete submission is the successful independent run above.
