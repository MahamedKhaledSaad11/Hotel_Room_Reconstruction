import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import threading
from urllib.parse import urlparse
import webbrowser


def main():
    parser = argparse.ArgumentParser(description="Open reconstructed scenes in a local interactive viewer")
    parser.add_argument("--run", nargs="+", type=Path, help="Directories containing scene.splat and run_manifest.json")
    parser.add_argument("--port", type=int, default=8790)
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    runs = args.run or [
        root / "reconstruction/runs/video0-kaggle/run",
        root / "reconstruction/runs/bridge/9819a66550fc4893bd00385b195a83fe",
    ]
    runs = [folder.resolve() for folder in runs]
    for folder in runs:
        for name in ("scene.splat", "run_manifest.json"):
            if not (folder / name).is_file():
                parser.error(f"Missing {folder / name}")
    build = root / "reconstruction/.runtime/interactive-viewer"
    build.mkdir(parents=True, exist_ok=True)
    source = Path(__file__).parent
    script = """
const esbuild = require(process.argv[1]);
esbuild.buildSync({entryPoints:[process.argv[2]],bundle:true,format:'esm',outfile:process.argv[3]});
"""
    subprocess.run(["node", "-e", script, str(root / "frontend/node_modules/esbuild"),
                    str(source / "main.js"), str(build / "app.js")], check=True)
    (build / "index.html").write_text((source / "index.html").read_text(encoding="utf-8"), encoding="utf-8")

    class Handler(SimpleHTTPRequestHandler):
        def do_GET(self):
            path = urlparse(self.path).path
            if path == "/scenes.json":
                data = json.dumps([{"id": i, "label": f"Video {i}"} for i in range(len(runs))]).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            parts = path.strip("/").split("/")
            if len(parts) == 3 and parts[0] == "scenes" and parts[1].isdigit():
                index = int(parts[1])
                if index < len(runs) and parts[2] in {"scene.splat", "run_manifest.json"}:
                    self.path = "/" + parts[2]
                    self.directory = str(runs[index])
                    try:
                        return super().do_GET()
                    finally:
                        self.directory = str(build)
            if path not in {"/", "/index.html", "/app.js"}:
                self.send_error(404)
                return
            super().do_GET()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=str(build)))
    url = f"http://127.0.0.1:{args.port}"
    print(f"Interactive viewer: {url}", flush=True)
    if args.open:
        threading.Timer(.5, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
