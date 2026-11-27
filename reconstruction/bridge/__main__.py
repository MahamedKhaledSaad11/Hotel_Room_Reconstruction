"""Run the reference reconstruction API using private Kaggle storage or worker callbacks."""
import argparse
import asyncio
from pathlib import Path

import uvicorn

from .app import Bridge


async def serve(args):
    from reconstruction.kaggle.launcher import KaggleDispatcher

    from reconstruction.kaggle.private import PrivateDispatcher

    dispatcher_type = KaggleDispatcher if args.public_url else PrivateDispatcher
    bridge = Bridge(Path(args.storage), args.public_url,
                    dispatcher_type(username=args.kaggle_username, dispatch_root=Path(args.storage) / "dispatches",
                                     pose_estimator=args.pose_estimator),
                    timeout=args.heartbeat_timeout, max_runtime=args.max_runtime,
                    max_upload_bytes=args.max_upload_mib * 1024**2)
    print(f"Local operator API: http://127.0.0.1:{args.operator_port}")
    print(f"Operator key file: {bridge.store.root / 'operator-secret.txt'}")
    if args.public_url:
        print(f"Tunnel ONLY http://127.0.0.1:{args.worker_port} to {args.public_url}")
    print(f"Run data: {bridge.store.root}")
    operator = uvicorn.Server(uvicorn.Config(bridge.operator, host="127.0.0.1", port=args.operator_port))
    worker = uvicorn.Server(uvicorn.Config(bridge.worker, host="127.0.0.1", port=args.worker_port, access_log=False))
    # A single owner handles Ctrl+C; both servers then stop together.
    servers = [operator, worker] if args.public_url else [operator]
    tasks = [asyncio.create_task(server.serve()) for server in servers]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        operator.should_exit = worker.should_exit = True
        await asyncio.gather(*tasks, return_exceptions=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-url", help="Optional HTTPS worker callback URL. Default uses private Kaggle datasets and polls logs.")
    parser.add_argument("--storage", default="reconstruction/runs/bridge")
    parser.add_argument("--operator-port", type=int, default=8765)
    parser.add_argument("--worker-port", type=int, default=8766)
    parser.add_argument("--kaggle-username")
    parser.add_argument("--pose-estimator", choices=["glomap", "colmap", "vggt"], default="glomap")
    parser.add_argument("--heartbeat-timeout", type=int, default=1800)
    parser.add_argument("--max-runtime", type=int, default=21600)
    parser.add_argument("--max-upload-mib", type=int, default=4096)
    args = parser.parse_args()
    if args.operator_port == args.worker_port:
        parser.error("Operator and worker ports must differ.")
    asyncio.run(serve(args))


if __name__ == "__main__":
    main()
