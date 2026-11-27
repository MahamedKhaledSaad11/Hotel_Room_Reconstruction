import shutil
import uuid
from pathlib import Path

from fastapi import UploadFile

from ..config import settings
from ..errors import AppError

ALLOWED_EXT = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}
RESULT_EXT_PRIORITY = [".splat", ".ksplat", ".spz", ".ply", ".glb", ".gltf", ".obj"]
CHUNK = 1024 * 1024


def root() -> Path:
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    return settings.storage_dir.resolve()


def abs_path(rel: str) -> Path:
    p = (root() / rel).resolve()
    if root() not in p.parents and p != root():
        raise AppError(400, "bad_path", "Invalid file path")
    return p


def _looks_like_video(head: bytes, ext: str) -> bool:
    if ext in (".mp4", ".mov", ".m4v"):
        return head[4:8] == b"ftyp" or head[4:8] in (b"moov", b"mdat", b"free", b"wide")
    if ext == ".avi":
        return head[:4] == b"RIFF" and head[8:12] == b"AVI "
    if ext in (".mkv", ".webm"):
        return head[:4] == b"\x1a\x45\xdf\xa3"
    return False


async def save_upload(file: UploadFile, project_id: str) -> tuple[str, int]:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise AppError(415, "unsupported_type", f"Unsupported video type. Allowed: {', '.join(sorted(ALLOWED_EXT))}")
    rel = f"uploads/{project_id}/input{ext}"
    dest = abs_path(rel)
    dest.parent.mkdir(parents=True, exist_ok=True)
    limit = settings.max_upload_mb * 1024 * 1024
    size, first = 0, b""
    try:
        with open(dest, "wb") as out:
            while chunk := await file.read(CHUNK):
                if not first:
                    first = chunk[:16]
                    if not _looks_like_video(first, ext):
                        raise AppError(415, "not_a_video", "File content does not look like a valid video")
                size += len(chunk)
                if size > limit:
                    raise AppError(413, "file_too_large", f"Video exceeds {settings.max_upload_mb} MB limit")
                out.write(chunk)
        if size == 0:
            raise AppError(400, "empty_file", "Uploaded file is empty")
    except Exception:
        shutil.rmtree(dest.parent, ignore_errors=True)
        raise
    return rel, size


def result_dir(project_id: str) -> Path:
    d = abs_path(f"results/{project_id}")
    d.mkdir(parents=True, exist_ok=True)
    return d


def find_result(project_id: str) -> str | None:
    d = result_dir(project_id)
    for ext in RESULT_EXT_PRIORITY:
        files = sorted(d.rglob(f"*{ext}"))
        if files:
            return str(files[0].relative_to(root()))
    return None


def delete_project_files(project_id: str) -> None:
    for sub in ("uploads", "results"):
        shutil.rmtree(abs_path(f"{sub}/{project_id}"), ignore_errors=True)


def new_id() -> str:
    return str(uuid.uuid4())
