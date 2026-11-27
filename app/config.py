import os
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    env: str = os.getenv("APP_ENV", "development")
    secret_key: str = os.getenv("SECRET_KEY", "dev-insecure-secret-change-me-please-32chars")
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./data/app.db")
    storage_dir: Path = Path(os.getenv("STORAGE_DIR", "./data/storage"))
    log_dir: Path = Path(os.getenv("LOG_DIR", "./data/logs"))
    cors_origins: tuple = tuple(
        o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",") if o.strip()
    )
    allow_registration: bool = _bool("ALLOW_REGISTRATION", True)
    admin_email: str = os.getenv("ADMIN_EMAIL", "")
    admin_password: str = os.getenv("ADMIN_PASSWORD", "")
    max_upload_mb: int = int(os.getenv("MAX_UPLOAD_MB", "500"))
    max_active_jobs_per_user: int = int(os.getenv("MAX_ACTIVE_JOBS_PER_USER", "2"))
    access_ttl_min: int = int(os.getenv("ACCESS_TTL_MIN", "30"))
    refresh_ttl_days: int = int(os.getenv("REFRESH_TTL_DAYS", "7"))
    worker_enabled: bool = _bool("WORKER_ENABLED", True)
    worker_concurrency: int = int(os.getenv("WORKER_CONCURRENCY", "1"))
    worker_poll_sec: float = float(os.getenv("WORKER_POLL_SEC", "1.0"))
    job_timeout_sec: int = int(os.getenv("JOB_TIMEOUT_SEC", "7200"))
    runner: str = os.getenv("RUNNER", "mock")
    recon_command: str = os.getenv("RECON_COMMAND", "")
    mock_step_delay: float = float(os.getenv("MOCK_STEP_DELAY", "0.5"))

    def validate(self) -> None:
        if self.env == "production" and self.secret_key.startswith("dev-insecure"):
            raise RuntimeError("SECRET_KEY must be set in production")
        if len(self.secret_key) < 32:
            raise RuntimeError("SECRET_KEY must be at least 32 characters")


settings = Settings()
