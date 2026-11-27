import time

from .conftest import FAKE_MP4


def upload(client, headers, name="Room 101", data=FAKE_MP4, filename="v.mp4"):
    return client.post("/api/projects", headers=headers, data={"name": name},
                       files={"file": (filename, data, "video/mp4")})


def wait_done(client, headers, pid, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        p = client.get(f"/api/projects/{pid}", headers=headers).json()
        if p["status"] in ("completed", "failed", "cancelled"):
            return p
        time.sleep(0.2)
    raise AssertionError("job did not finish")


def test_health(client):
    assert client.get("/health").json()["status"] == "ok"


def test_auth_required(client):
    r = client.get("/api/projects")
    assert r.status_code == 401 and r.json()["error"]["code"] == "not_authenticated"


def test_register_duplicate_and_validation(client, alice):
    r = client.post("/api/auth/register", json={"email": "alice@test.com", "password": "Password123"})
    assert r.status_code == 409
    r = client.post("/api/auth/register", json={"email": "bad", "password": "short"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


def test_login_wrong_password(client, alice):
    r = client.post("/api/auth/login", json={"email": "alice@test.com", "password": "nope-nope"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "bad_credentials"


def test_refresh_and_me(client):
    r = client.post("/api/auth/login", json={"email": "alice@test.com", "password": "Password123"}).json()
    r2 = client.post("/api/auth/refresh", json={"refresh_token": r["refresh_token"]})
    assert r2.status_code == 200
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {r2.json()['access_token']}"})
    assert me.json()["email"] == "alice@test.com"
    # refresh token can't be used as access token
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {r['refresh_token']}"}).status_code == 401


def test_upload_validation(client, alice):
    assert upload(client, alice, filename="x.txt").status_code == 415
    assert upload(client, alice, data=b"not a video at all" * 10).json()["error"]["code"] == "not_a_video"
    assert upload(client, alice, data=FAKE_MP4 + b"0" * (1024 * 1024)).status_code == 413


def test_full_flow_and_permissions(client, alice, bob, admin):
    r = upload(client, alice)
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    # viewer not ready check is racy with fast mock; just wait for completion
    p = wait_done(client, alice, pid)
    assert p["status"] == "completed" and p["has_result"] and p["result_format"] == "splat"
    logs = client.get(f"/api/projects/{pid}/logs", headers=alice).json()
    assert any("Job completed" in l["message"] for l in logs)

    v = client.get(f"/api/projects/{pid}/viewer", headers=alice).json()
    f = client.get(v["url"])  # no auth header: signed token only
    assert f.status_code == 200 and len(f.content) % 32 == 0 and len(f.content) > 0

    # other user: 404 everywhere
    for path in (f"/api/projects/{pid}", f"/api/projects/{pid}/logs", f"/api/projects/{pid}/viewer"):
        assert client.get(path, headers=bob).status_code == 404
    assert client.delete(f"/api/projects/{pid}", headers=bob).status_code == 404
    assert client.get(f"/api/assets/{pid}/result").status_code == 401
    # token of another project is rejected
    other = upload(client, bob).json()["id"]
    wait_done(client, bob, other)
    bob_token = client.get(f"/api/projects/{other}/viewer", headers=bob).json()["url"].split("token=")[1]
    assert client.get(f"/api/assets/{pid}/result?token={bob_token}").status_code == 403
    # bob's list excludes alice's; admin sees all
    assert pid not in [x["id"] for x in client.get("/api/projects", headers=bob).json()]
    assert pid in [x["id"] for x in client.get("/api/projects?all=true", headers=admin).json()]
    assert client.get("/api/projects?all=true", headers=bob).json() != []  # 'all' ignored for non-admins
    assert pid not in [x["id"] for x in client.get("/api/projects?all=true", headers=bob).json()]
    # delete
    assert client.delete(f"/api/projects/{pid}", headers=alice).status_code == 204
    assert client.get(f"/api/projects/{pid}", headers=alice).status_code == 404


def test_admin_permissions(client, alice, admin):
    assert client.get("/api/admin/users", headers=alice).status_code == 403
    users = client.get("/api/admin/users", headers=admin).json()
    assert {u["email"] for u in users} >= {"admin@test.com", "alice@test.com"}
    assert client.get("/api/admin/audit", headers=admin).status_code == 200


def test_disable_user_revokes_access(client, admin):
    from .conftest import make_user
    h = make_user(client, "carol@test.com")
    uid = client.get("/api/auth/me", headers=h).json()["id"]
    assert client.patch(f"/api/admin/users/{uid}", headers=admin, json={"is_active": False}).status_code == 200
    assert client.get("/api/auth/me", headers=h).status_code == 401
    r = client.post("/api/auth/login", json={"email": "carol@test.com", "password": "Password123"})
    assert r.status_code == 403


def test_logout_revokes_tokens(client):
    from .conftest import make_user
    h = make_user(client, "dave@test.com")
    assert client.post("/api/auth/logout", headers=h).status_code == 204
    assert client.get("/api/auth/me", headers=h).status_code == 401


def test_viewer_not_ready_and_cancel_retry(client, alice):
    from app.models import Project
    from app.db import SessionLocal
    pid = upload(client, alice).json()["id"]
    wait_done(client, alice, pid)
    assert client.post(f"/api/projects/{pid}/cancel", headers=alice).status_code == 409
    with SessionLocal() as db:  # force a failed state to test retry + viewer guard
        p = db.get(Project, pid); p.status = "failed"; db.commit()
    assert client.get(f"/api/projects/{pid}/viewer", headers=alice).json()["error"]["code"] == "result_not_ready"
    assert client.post(f"/api/projects/{pid}/retry", headers=alice).json()["status"] == "queued"
    assert wait_done(client, alice, pid)["status"] == "completed"


def test_brute_force_lockout(client, alice):
    for _ in range(5):
        client.post("/api/auth/login", json={"email": "alice@test.com", "password": "wrongwrong"})
    r = client.post("/api/auth/login", json={"email": "alice@test.com", "password": "Password123"})
    assert r.status_code == 429
