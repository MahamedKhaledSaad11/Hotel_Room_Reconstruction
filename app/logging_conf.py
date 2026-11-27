import json
import logging
import sys
from logging.handlers import RotatingFileHandler

from .config import settings


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        data = {"ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"), "level": record.levelname,
                "logger": record.name, "msg": record.getMessage()}
        for k in ("request_id", "user_id", "method", "path", "status", "ms"):
            if hasattr(record, k):
                data[k] = getattr(record, k)
        if record.exc_info:
            data["exc"] = self.formatException(record.exc_info)
        return json.dumps(data, ensure_ascii=False)


def setup_logging() -> None:
    settings.log_dir.mkdir(parents=True, exist_ok=True)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers.clear()
    fmt = JsonFormatter()
    for h in (logging.StreamHandler(sys.stdout),
              RotatingFileHandler(settings.log_dir / "app.log", maxBytes=5_000_000, backupCount=5, encoding="utf-8")):
        h.setFormatter(fmt)
        root.addHandler(h)
    logging.getLogger("uvicorn.access").disabled = True  # we log requests ourselves
