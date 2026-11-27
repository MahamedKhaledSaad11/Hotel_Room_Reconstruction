// Drop-in API client for your frontend. Set VITE_API_URL (e.g. http://localhost:8000).
const BASE = import.meta.env?.VITE_API_URL ?? "http://localhost:8000";
let tokens = JSON.parse(localStorage.getItem("tokens") || "null");
const save = (t) => { tokens = t; t ? localStorage.setItem("tokens", JSON.stringify(t)) : localStorage.removeItem("tokens"); };

async function request(path, { method = "GET", json, form, retry = true } = {}) {
  const headers = {};
  if (tokens) headers.Authorization = `Bearer ${tokens.access_token}`;
  if (json) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body: json ? JSON.stringify(json) : form });
  if (res.status === 401 && retry && tokens?.refresh_token && !path.startsWith("/api/auth/")) {
    const r = await fetch(BASE + "/api/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: tokens.refresh_token }) });
    if (r.ok) { save(await r.json()); return request(path, { method, json, form, retry: false }); }
    save(null); window.location.assign("/login");
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || "Request failed"), { code: data?.error?.code, status: res.status, details: data?.error?.details });
  return data;
}

export const api = {
  register: async (email, password, name) => { const t = await request("/api/auth/register", { method: "POST", json: { email, password, name } }); save(t); return t.user; },
  login: async (email, password) => { const t = await request("/api/auth/login", { method: "POST", json: { email, password } }); save(t); return t.user; },
  logout: async () => { try { await request("/api/auth/logout", { method: "POST" }); } finally { save(null); } },
  me: () => request("/api/auth/me"),
  listProjects: () => request("/api/projects"),
  getProject: (id) => request(`/api/projects/${id}`),
  logs: (id, afterId = 0) => request(`/api/projects/${id}/logs?after_id=${afterId}`),
  upload: (name, file) => { const f = new FormData(); f.append("name", name); f.append("file", file); return request("/api/projects", { method: "POST", form: f }); },
  cancel: (id) => request(`/api/projects/${id}/cancel`, { method: "POST" }),
  retry: (id) => request(`/api/projects/${id}/retry`, { method: "POST" }),
  remove: (id) => request(`/api/projects/${id}`, { method: "DELETE" }),
  viewer: (id) => request(`/api/projects/${id}/viewer`), // -> { url, format, expires_in } : feed url to your splat/3D viewer
};

// Poll until finished: await pollProject(id, p => setProgress(p.progress, p.stage))
export async function pollProject(id, onUpdate, every = 2000) {
  for (;;) {
    const p = await api.getProject(id); onUpdate(p);
    if (["completed", "failed", "cancelled"].includes(p.status)) return p;
    await new Promise((r) => setTimeout(r, every));
  }
}
