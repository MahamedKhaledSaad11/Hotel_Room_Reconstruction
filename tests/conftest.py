import os
import tempfile

_tmp = tempfile.mkdtemp()
os.environ.update({
    "DATABASE_URL": f"sqlite:///{_tmp}/t.db", "STORAGE_DIR": f"{_tmp}/storage", "LOG_DIR": f"{_tmp}/logs",
    "SECRET_KEY": "test-secret-key-test-secret-key-1234", "RUNNER": "mock", "MOCK_STEP_DELAY": "0",
    "WORKER_POLL_SEC": "0.1", "ADMIN_EMAIL": "admin@test.com", "ADMIN_PASSWORD": "AdminPass123",
    "MAX_UPLOAD_MB": "1", "MAX_ACTIVE_JOBS_PER_USER": "3",
})

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def make_user(client, email, pw="Password123"):
    r = client.post("/api/auth/register", json={"email": email, "password": pw, "name": email.split("@")[0]})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def alice(client):
    return make_user(client, "alice@test.com")


@pytest.fixture(scope="session")
def bob(client):
    return make_user(client, "bob@test.com")


@pytest.fixture(scope="session")
def admin(client):
    r = client.post("/api/auth/login", json={"email": "admin@test.com", "password": "AdminPass123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


FAKE_MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 2000
