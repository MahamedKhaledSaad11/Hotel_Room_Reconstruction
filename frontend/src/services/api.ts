import {
  AtelierSettings,
  ForgotPasswordResponse,
  Project,
  ProjectShareDTO,
  ReconstructionTask,
  SceneData,
  SharedSceneData,
  UserProfile,
  VideoConstraintsConfig,
  VideoUploadResponse,
} from '../types';
import { INITIAL_SETTINGS } from '../data/mockData';

export const STORAGE_KEYS = {
  settings: 'auraspace_settings_v2',
  user: 'auraspace_user_v2',
  projects: 'auraspace_projects_v1',
  tasks: 'auraspace_tasks_v1',
  token: 'auraspace_token_v1',
  signedOut: 'auraspace_signed_out',
  sessionId: 'auraspace_session_id_v1',
};

let unauthorizedCallback: (() => void) | null = null;

export function setOnUnauthorizedCallback(cb: (() => void) | null): void {
  unauthorizedCallback = cb;
}

export class ApiHttpError extends Error {
  status: number;
  errorCode?: string;
  retryable?: boolean;
  constructor(
    status: number,
    message: string,
    errorCode?: string,
    retryable?: boolean
  ) {
    super(message);
    this.name = 'ApiHttpError';
    this.status = status;
    this.errorCode = errorCode;
    this.retryable = retryable;
  }
}

export function safeStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeStorageSet(
  key: string,
  value: string,
  storage: 'local' | 'session' = 'local'
): void {
  try {
    if (storage === 'session') {
      sessionStorage.setItem(key, value);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Ignore quota / privacy mode errors
  }
}

export function safeStorageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore
  }
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Ignore
  }
}

export function safeReadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function safeWriteJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }
}

export function getOrCreateSessionId(): string {
  const existing = safeStorageGet(STORAGE_KEYS.sessionId);
  if (existing && existing.trim()) return existing.trim();
  const generated =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `sess_${crypto.randomUUID()}`
      : `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  safeStorageSet(STORAGE_KEYS.sessionId, generated, 'local');
  return generated;
}

export function rotateSessionId(): string {
  const generated =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `sess_${crypto.randomUUID()}`
      : `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  safeStorageSet(STORAGE_KEYS.sessionId, generated, 'local');
  return generated;
}

export function getStoredSettings(): AtelierSettings {
  const stored = safeReadJson<Partial<AtelierSettings>>(
    STORAGE_KEYS.settings,
    {}
  );
  return { ...INITIAL_SETTINGS, ...stored };
}

export function saveStoredSettings(settings: AtelierSettings): void {
  safeWriteJson(STORAGE_KEYS.settings, settings);
}

export function getApiBaseUrl(): string {
  const settings = getStoredSettings();
  const configured = settings.apiBaseUrl.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const envUrl = import.meta.env.VITE_API_URL as string | undefined;
  return envUrl && envUrl.trim() ? envUrl.trim().replace(/\/+$/, '') : '/api';
}

export function isDemoMode(): boolean {
  return false;
}

export function isLiveMode(): boolean {
  return true;
}

function resolveArtifactUrl(
  baseUrl: string,
  maybeRelative: string | null | undefined
): string {
  if (!maybeRelative) return '';
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
  if (!baseUrl) return maybeRelative;
  return `${baseUrl}${maybeRelative.startsWith('/') ? '' : '/'}${maybeRelative}`;
}

function buildAuthHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  if (!headers.has('X-Session-Id')) {
    headers.set('X-Session-Id', getOrCreateSessionId());
  }
  const token = safeStorageGet(STORAGE_KEYS.token);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

async function fetchLive<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 8000
): Promise<T> {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    throw new ApiHttpError(
      0,
      'Backend API URL is not configured. Set the backend URL in Settings.',
      'BACKEND_NOT_CONFIGURED',
      true
    );
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = buildAuthHeaders(options.headers);
    if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      });
    } catch (networkErr) {
      const msg =
        networkErr instanceof DOMException && networkErr.name === 'AbortError'
          ? 'Request timed out waiting for FastAPI backend.'
          : 'Cannot reach FastAPI backend — verify the server is running and retry.';
      throw new ApiHttpError(0, msg, 'NETWORK_UNREACHABLE', true);
    }

    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      let errorCode: string | undefined;
      let retryable = res.status >= 500 || res.status === 408;
      try {
        const bodyText = await res.text();
        if (bodyText) {
          const parsed = JSON.parse(bodyText) as {
            detail?: string;
            message?: string;
            error_code?: string;
            retryable?: boolean;
          };
          detail = parsed.detail || parsed.message || detail;
          errorCode = parsed.error_code;
          if (typeof parsed.retryable === 'boolean')
            retryable = parsed.retryable;
        }
      } catch {
        // Keep status text
      }
      if (res.status === 401 && !path.startsWith('/auth/')) {
        safeStorageRemove(STORAGE_KEYS.token);
        safeStorageRemove(STORAGE_KEYS.user);
        if (unauthorizedCallback) {
          unauthorizedCallback();
        }
      }
      throw new ApiHttpError(res.status, detail, errorCode, retryable);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    const text = await res.text();
    if (!text) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBackendProject(raw: any): Project {
  const status = (raw.status ?? 'draft') as Project['status'];
  const category = (raw.category ?? 'living') as Project['category'];
  const qualityMode = (raw.quality_mode ??
    raw.qualityMode ??
    'atelier') as Project['qualityMode'];
  return {
    id: raw.id,
    name: raw.name,
    category,
    categoryLabel: raw.categoryLabel ?? `${category.toUpperCase()} • ${status}`,
    status,
    progress: raw.progress ?? 0,
    estimatedMinutesLeft: raw.estimatedMinutesLeft,
    areaSqm: raw.areaSqm ?? 0,
    dimensionsLabel:
      raw.dimensionsLabel ??
      (raw.gaussian_count ? 'Unscaled reconstruction' : 'Pending Capture'),
    qualityBadge:
      raw.qualityBadge ??
      (qualityMode === 'atelier' ? 'Atelier • 960px' : 'Sketch • 640px'),
    qualityMode,
    scannedAtLabel:
      raw.scannedAtLabel ??
      (status === 'ready'
        ? 'Ready'
        : status === 'processing'
          ? 'In Progress'
          : status === 'failed'
            ? 'Failed'
            : 'Draft'),
    createdAt: raw.created_at ?? raw.createdAt ?? new Date().toISOString(),
    description: raw.description ?? '',
    thumbnailUrl: raw.thumbnailUrl ?? raw.thumbnail_url ?? '',
    frameCount: raw.frame_count ?? raw.frameCount ?? undefined,
    splatCountLabel:
      raw.splatCountLabel ??
      (raw.gaussian_count
        ? `${Number(raw.gaussian_count).toLocaleString()} Gaussians`
        : undefined),
    taskId: raw.active_task_id ?? raw.taskId ?? undefined,
    videoFileName: raw.video_filename ?? raw.videoFileName ?? undefined,
    videoReady: raw.video_ready ?? raw.videoReady,
    videoDurationSec: raw.video_duration_sec ?? raw.videoDurationSec,
    videoWidth: raw.video_width ?? raw.videoWidth,
    videoHeight: raw.video_height ?? raw.videoHeight,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBackendTask(raw: any): ReconstructionTask {
  return {
    id: raw.id,
    projectId: raw.project_id ?? raw.projectId,
    runId: raw.run_id ?? raw.runId,
    taskType: raw.task_type ?? raw.taskType ?? 'reconstruction',
    projectName:
      raw.projectName ?? raw.project_name ?? raw.project_id ?? 'Room Scan',
    scanBadge:
      raw.scanBadge ??
      `RUN ${(raw.run_id ?? raw.id ?? '').slice(-6).toUpperCase()}`,
    status: raw.status,
    stage: raw.stage,
    progress: raw.progress ?? 0,
    estimatedMinutes: raw.estimated_minutes ?? raw.estimatedMinutes ?? 0,
    substepMessage: raw.substep_message ?? raw.substepMessage ?? '',
    error: raw.error ?? null,
    fps: raw.fps ?? 2,
    maxLongSide: (raw.max_long_side ?? raw.maxLongSide ?? 960) as
      | 640
      | 768
      | 960,
    dropBlurry: raw.drop_blurry ?? raw.dropBlurry ?? true,
    poseEstimator: raw.pose_estimator ?? raw.poseEstimator ?? 'GLOMAP',
    extractedFrames: raw.extracted_frames ?? raw.extractedFrames ?? 0,
    droppedFrames: raw.dropped_frames ?? raw.droppedFrames ?? 0,
    registeredFrames: raw.registered_frames ?? raw.registeredFrames ?? 0,
    iterationsDone: raw.iterations_done ?? raw.iterationsDone ?? 0,
    iterationsTotal: raw.iterations_total ?? raw.iterationsTotal ?? 0,
    gaussiansCount: raw.gaussians_count ?? raw.gaussiansCount ?? 0,
    peakVramGb: raw.peak_vram_gb ?? raw.peakVramGb ?? 0,
    wallTimeSec: raw.wall_time_sec ?? raw.wallTimeSec ?? 0,
    logs: Array.isArray(raw.logs) ? raw.logs : [],
    createdAt: raw.created_at ?? raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updated_at ?? raw.updatedAt,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBackendScene(
  raw: any,
  baseUrl: string,
  project: Project
): SceneData {
  const vt = raw.viewer_transform ?? raw.viewerTransform;
  const original = raw.versions?.original;
  return {
    projectId: raw.project_id ?? raw.projectId ?? project.id,
    runId: raw.run_id ?? raw.runId,
    splatUrl: resolveArtifactUrl(
      baseUrl,
      original?.splat_url ?? original?.splatUrl ?? raw.splat_url ?? raw.splatUrl
    ),
    pointCloudUrl: resolveArtifactUrl(
      baseUrl,
      original?.sparse_cloud_url ??
        original?.sparseCloudUrl ??
        raw.point_cloud_url ??
        raw.pointCloudUrl
    ),
    manifestUrl:
      resolveArtifactUrl(baseUrl, raw.manifest_url ?? raw.manifestUrl) || null,
    viewerTransform: vt
      ? {
          colmapToThreejsMatrix:
            vt.colmap_to_threejs_matrix ?? vt.colmapToThreejsMatrix,
          sceneBoundsMin: vt.scene_bounds_min ?? vt.sceneBoundsMin,
          sceneBoundsMax: vt.scene_bounds_max ?? vt.sceneBoundsMax,
        }
      : undefined,
    gaussianCount:
      original?.gaussian_count ??
      original?.gaussianCount ??
      raw.gaussian_count ??
      raw.gaussianCount ??
      0,
    cameraPoses:
      Array.isArray(raw.camera_poses ?? raw.cameraPoses) &&
      (raw.camera_poses ?? raw.cameraPoses).length
        ? (raw.camera_poses ?? raw.cameraPoses)
        : raw.initial_camera?.position && raw.initial_camera?.target
          ? [
              {
                ...raw.initial_camera,
                id: 'initial',
                label: 'Capture viewpoint',
                coordinateSpace: 'threejs',
              },
            ]
          : [],
  };
}

export interface AuthResponse {
  user: UserProfile;
  token: string;
  mode: 'backend' | 'local';
}

export const api = {
  async testConnection(
    url: string
  ): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const trimmed = url.trim().replace(/\/+$/, '') || getApiBaseUrl();
    const start = performance.now();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4500);
    try {
      const headers = buildAuthHeaders();
      const healthRes = await fetch(`${trimmed}/health`, {
        headers,
        signal: controller.signal,
      });
      const projRes = await fetch(`${trimmed}/projects`, {
        headers,
        signal: controller.signal,
      });
      const latencyMs = Math.round(performance.now() - start);
      if (healthRes.ok && projRes.ok) {
        return {
          ok: true,
          message: `Connected to FastAPI backend (HTTP ${projRes.status}, session ${getOrCreateSessionId().slice(0, 12)})`,
          latencyMs,
        };
      }
      return {
        ok: false,
        message: `Backend responded with HTTP ${projRes.status} — check auth or route.`,
        latencyMs,
      };
    } catch {
      const latencyMs = Math.round(performance.now() - start);
      return {
        ok: false,
        message:
          'Backend unreachable from browser — verify uvicorn / tunnel is running.',
        latencyMs,
      };
    } finally {
      window.clearTimeout(timer);
    }
  },

  async login(
    email: string,
    password: string,
    remember = true
  ): Promise<AuthResponse> {
    const storageTarget = remember ? 'local' : 'session';
    const data = await fetchLive<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    safeStorageRemove(STORAGE_KEYS.token);
    safeStorageSet(STORAGE_KEYS.token, data.token, storageTarget);
    safeWriteJson(STORAGE_KEYS.user, data.user);
    return { ...data, mode: 'backend' };
  },

  async signup(payload: {
    fullName: string;
    email: string;
    password: string;
    role: UserProfile['role'];
  }): Promise<AuthResponse> {
    // Signup creates the account on the real backend and requires explicit Sign In (Sign Up -> Login)
    const data = await fetchLive<AuthResponse>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    safeStorageRemove(STORAGE_KEYS.token);
    safeStorageRemove(STORAGE_KEYS.user);
    return { ...data, mode: 'backend' };
  },

  async getMe(): Promise<UserProfile> {
    const user = await fetchLive<UserProfile>('/auth/me');
    safeWriteJson(STORAGE_KEYS.user, user);
    return user;
  },

  async updateMe(updates: Partial<UserProfile>): Promise<UserProfile> {
    const user = await fetchLive<UserProfile>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    safeWriteJson(STORAGE_KEYS.user, user);
    return user;
  },

  async changePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<AuthResponse> {
    const data = await fetchLive<AuthResponse & { ok?: boolean }>(
      '/auth/change-password',
      {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      }
    );
    const storageTarget =
      localStorage.getItem(STORAGE_KEYS.token) !== null ? 'local' : 'session';
    safeStorageRemove(STORAGE_KEYS.token);
    safeStorageSet(STORAGE_KEYS.token, data.token, storageTarget);
    safeWriteJson(STORAGE_KEYS.user, data.user);
    return { user: data.user, token: data.token, mode: 'backend' };
  },

  async logout(): Promise<void> {
    if (safeStorageGet(STORAGE_KEYS.token)) {
      try {
        await fetchLive<{ ok: boolean }>('/auth/logout', { method: 'POST' });
      } catch {
        // Best-effort revocation; local cleanup still proceeds
      }
    }
    safeStorageRemove(STORAGE_KEYS.token);
    safeStorageRemove(STORAGE_KEYS.user);
  },

  async forgotPassword(email: string): Promise<ForgotPasswordResponse> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await fetchLive<any>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    return {
      ok: Boolean(raw.ok ?? true),
      message: raw.message || 'Recovery instructions issued.',
      devResetToken: raw.dev_reset_token ?? undefined,
    };
  },

  async resetPassword(
    token: string,
    newPassword: string
  ): Promise<{ ok: boolean }> {
    return await fetchLive<{ ok: boolean }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    });
  },

  async createProjectShare(
    projectId: string,
    label = 'Client Walkthrough Link',
    expiresInHours = 72
  ): Promise<ProjectShareDTO> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await fetchLive<any>(`/projects/${projectId}/shares`, {
      method: 'POST',
      body: JSON.stringify({ label, expires_in_hours: expiresInHours }),
    });
    return {
      shareId: raw.share_id,
      projectId: raw.project_id,
      label: raw.label,
      shareToken: raw.share_token,
      sharePath: raw.share_path,
      isActive: true,
      expiresAt: raw.expires_at,
      createdAt: raw.created_at,
    };
  },

  async listProjectShares(projectId: string): Promise<ProjectShareDTO[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await fetchLive<any[]>(`/projects/${projectId}/shares`);
    return rows.map((raw) => ({
      shareId: raw.share_id,
      projectId: raw.project_id,
      label: raw.label,
      isActive: Boolean(raw.is_active),
      expiresAt: raw.expires_at,
      revokedAt: raw.revoked_at ?? null,
      createdAt: raw.created_at,
    }));
  },

  async revokeProjectShare(projectId: string, shareId: string): Promise<void> {
    await fetchLive<void>(`/projects/${projectId}/shares/${shareId}`, {
      method: 'DELETE',
    });
  },

  async getSharedScene(shareToken: string): Promise<SharedSceneData> {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      throw new ApiHttpError(
        0,
        'Backend API URL is not configured.',
        'BACKEND_NOT_CONFIGURED',
        false
      );
    }
    let res: Response;
    try {
      res = await fetch(
        `${baseUrl}/shared/${encodeURIComponent(shareToken)}/scene`
      );
    } catch {
      throw new ApiHttpError(
        0,
        'Unable to reach AuraSpace backend.',
        'NETWORK_UNREACHABLE',
        true
      );
    }
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const parsed = (await res.json()) as { detail?: string };
        if (parsed.detail) detail = parsed.detail;
      } catch {
        // Keep status text
      }
      throw new ApiHttpError(res.status, detail);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await res.json();
    const syntheticProj: Project = {
      id: raw.project_id,
      name: raw.project_name || 'Shared 3D Room',
      category: 'living',
      categoryLabel: 'Shared Walkthrough',
      status: 'ready',
      progress: 100,
      areaSqm: 0,
      dimensionsLabel: 'Unscaled reconstruction',
      qualityBadge: 'Read-Only Share',
      qualityMode: 'atelier',
      scannedAtLabel: 'Shared',
      createdAt: new Date().toISOString(),
      description: '',
      thumbnailUrl: '',
    };
    const mapped = mapBackendScene(raw, baseUrl, syntheticProj);
    return {
      ...mapped,
      projectName: raw.project_name || 'Shared 3D Room',
      shareLabel: raw.share_label || 'Client Walkthrough',
      readOnly: Boolean(raw.read_only ?? true),
    };
  },

  async getProjects(): Promise<Project[]> {
    const data = await fetchLive<unknown[]>('/projects');
    return data.map(mapBackendProject);
  },

  async getProject(projectId: string): Promise<Project> {
    const raw = await fetchLive<unknown>(`/projects/${projectId}`);
    return mapBackendProject(raw);
  },

  async createProject(config: VideoConstraintsConfig): Promise<Project> {
    const name = config.roomName.trim() || 'Untitled Space';
    const description = `${config.videoFileName} (${config.fps} fps, ${config.maxLongSide}px max side${
      config.dropBlurryFrames ? ', blur filtered' : ''
    }).`;

    const created = await fetchLive<unknown>('/projects', {
      method: 'POST',
      body: JSON.stringify({
        name,
        category: config.category,
        quality_mode: config.qualityMode,
        description,
      }),
    });
    return mapBackendProject(created);
  },

  async deleteProject(projectId: string): Promise<void> {
    await fetchLive<void>(`/projects/${projectId}`, { method: 'DELETE' });
  },

  async uploadVideo(
    projectId: string,
    file: File | null,
    constraints: VideoConstraintsConfig
  ): Promise<{
    uploaded: boolean;
    frameEstimate: number;
    details?: VideoUploadResponse;
  }> {
    if (!file) {
      throw new ApiHttpError(
        400,
        'A real room walkthrough video file (.mp4, .mov, .webm) is required in Live Mode.',
        'VIDEO_FILE_REQUIRED',
        true
      );
    }

    const form = new FormData();
    form.append('file', file);
    form.append('fps', String(constraints.fps));
    form.append('max_long_side', String(constraints.maxLongSide));
    form.append('drop_blurry', String(constraints.dropBlurryFrames));
    // Allow generous timeout for large room video uploads
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await fetchLive<any>(
      `/projects/${projectId}/video`,
      { method: 'POST', body: form },
      120000
    );
    const frameEstimate = Number(raw.frame_estimate ?? raw.frameEstimate ?? 0);
    return {
      uploaded: Boolean(raw.uploaded ?? true),
      frameEstimate,
      details: raw.size_bytes
        ? {
            projectId: raw.project_id,
            uploaded: raw.uploaded,
            videoFilename: raw.video_filename,
            sizeBytes: raw.size_bytes,
            durationSec: raw.duration_sec,
            width: raw.width,
            height: raw.height,
            sourceFps: raw.source_fps,
            fps: raw.fps,
            maxLongSide: raw.max_long_side,
            dropBlurry: raw.drop_blurry,
            frameEstimate,
            sha256: raw.sha256,
          }
        : undefined,
    };
  },

  async startReconstruction(
    project: Project,
    constraints?: Partial<VideoConstraintsConfig>
  ): Promise<ReconstructionTask> {
    const settings = getStoredSettings();
    const fps = constraints?.fps ?? 2;
    const maxLongSide =
      constraints?.maxLongSide ?? settings.defaultMaxResolution;
    const dropBlurry = constraints?.dropBlurryFrames ?? true;

    const remoteTask = await fetchLive<unknown>(
      `/projects/${project.id}/reconstruct`,
      {
        method: 'POST',
        body: JSON.stringify({
          fps,
          max_long_side: maxLongSide,
          drop_blurry: dropBlurry,
          pose_estimator: settings.defaultPoseEstimator,
          quality_mode: project.qualityMode,
        }),
      }
    );
    const mapped = mapBackendTask(remoteTask);
    return { ...mapped, projectName: project.name };
  },

  async getTask(taskId: string): Promise<ReconstructionTask | null> {
    try {
      const raw = await fetchLive<unknown>(`/tasks/${taskId}`);
      return mapBackendTask(raw);
    } catch (err) {
      if (
        err instanceof ApiHttpError &&
        (err.status === 404 || err.status === 403)
      ) {
        return null;
      }
      throw err;
    }
  },

  async cancelTask(taskId: string): Promise<ReconstructionTask | null> {
    const raw = await fetchLive<unknown>(`/tasks/${taskId}/cancel`, {
      method: 'POST',
    });
    return mapBackendTask(raw);
  },

  async getScene(project: Project): Promise<SceneData> {
    const baseUrl = getApiBaseUrl();
    const raw = await fetchLive<unknown>(`/projects/${project.id}/scene`);
    return mapBackendScene(raw, baseUrl, project);
  },
};
