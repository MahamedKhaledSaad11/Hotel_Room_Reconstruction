
import os, pathlib, time
video = os.environ["INPUT_VIDEO"]
out = pathlib.Path(os.environ["OUTPUT_DIR"])
print("PROGRESS: 10 Extracting frames")
time.sleep(1)
print("PROGRESS: 60 Training splats")
(out / "scene.ply").write_bytes(b"ply\nformat ascii 1.0\nend_header\n")
print("done", video)
