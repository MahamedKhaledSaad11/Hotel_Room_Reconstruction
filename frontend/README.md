# Hotel reconstruction frontend

Use Node.js 24 LTS and install dependencies from this directory.

```powershell
cd E:\Plus_Project\frontend
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The production build is generated with `npm run build`. Use `npm run preview` to serve that build locally.

The application covers signup/login, projects, video upload, reconstruction progress, the 3D scene viewer and scene sharing. Configure the backend using `.env.local` based on [.env.example](.env.example), or set its URL in Settings. By default, Vite forwards `/api` to http://127.0.0.1:8000. Set `VITE_DEV_PROXY_TARGET` to change that development target. API-backed actions require a running backend.

The scene viewer uses physical W/A/S/D key positions and arrow keys for movement, Q/E vertically, and mouse dragging to look around. Scene assets and camera metadata come from the project scene endpoint. The backend handoff is documented in [INTEGRATION.md](../reconstruction/INTEGRATION.md).

The primary backend routes are listed below. Paths are relative to the configured API base URL.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/signup`, `/auth/login` | Account creation and token login |
| GET | `/auth/me` | Restore the current authenticated user |
| GET, POST | `/projects` | List or create projects owned by the user |
| GET, DELETE | `/projects/{id}` | Project metadata or deletion |
| POST | `/projects/{id}/video` | Multipart video upload |
| POST | `/projects/{id}/reconstruct` | Submit reconstruction with capture options |
| GET | `/tasks/{id}` | Actual task status, stage and reported progress |
| POST | `/tasks/{id}/cancel` | Cancel a task |
| GET | `/projects/{id}/scene` | Scene URLs, Gaussian count and camera metadata |
| GET, POST | `/projects/{id}/shares` | List or create share links for users with sharing permission |
| DELETE | `/projects/{id}/shares/{shareId}` | Revoke a share |
| GET | `/shared/{token}/scene` | Read-only public scene |

Task completion is determined by `status: "completed"`. Stage percentages may reach 100 while the next stage is still pending. The pipeline emits stage-local percentages. The backend should forward the real stage and adapt progress consistently for its task API.

For the scene response, serve the stored artifact URL as `splat_url` and copy `gaussian_count`, `viewer_transform` and `initial_camera` from the generated manifest. Optional `point_cloud_url` enables sparse-cloud viewing. The manifest's initial camera uses viewer coordinates. Existing `camera_poses` entries can specify `coordinateSpace: "threejs"`; entries without that marker use the original COLMAP convention. The precise wire mapping is in [api.ts](src/services/api.ts).

If a moved workspace contains an old npm command pointing to a different drive or project directory, regenerate its command shims with `npm rebuild`. A fresh checkout uses `npm ci`, which installs dependencies and creates commands for its current location. [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci) · [Vite setup](https://vite.dev/guide/)
