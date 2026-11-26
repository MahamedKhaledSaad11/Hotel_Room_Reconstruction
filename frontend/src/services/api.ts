import {
  AtelierSettings,
  DiffusionPreviewResult,
  EditSessionDTO,
  ForgotPasswordResponse,
  FrameMaskRecordDTO,
  MaskPoint,
  PixelClick,
  PreviewVariantDTO,
  Project,
  ProjectShareDTO,
  ReconstructionTask,
  ReviewedFrameDecision,
  SampledFrame,
  SceneData,
  SegmentResult,
  SharedSceneData,
  UserProfile,
  VideoConstraintsConfig,
  VideoUploadResponse,
} from '../types';
import {
  buildMockScene,
  INITIAL_PROJECTS,
  INITIAL_SETTINGS,
  INITIAL_TASKS,
  STITCH_IMAGES,
} from '../data/mockData';

export const STORAGE_KEYS = {
  settings: 'auraspace_settings_v2',
  user: 'auraspace_user_v2',
  projects: 'auraspace_projects_v1',
  tasks: 'auraspace_tasks_v1',
  token: 'auraspace_token_v1',
  signedOut: 'auraspace_signed_out',
  sessionId: 'auraspace_session_id_v1',
};

const projectRunIds: Record<string, string> = {};
let unauthorizedCallback: (() => void) | null = null;

export function setOnUnauthorizedCallback(cb: (() => void) | null): void {
  unauthorizedCallback = cb;
}

export class ApiHttpError extends Error {
  status: number;
  errorCode?: string;
  retryable?: boolean;
  constructor(status: number, message: string, errorCode?: string, retryable?: boolean) {
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
  const stored = safeReadJson<Partial<AtelierSettings>>(STORAGE_KEYS.settings, {});
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

function resolveArtifactUrl(baseUrl: string, maybeRelative: string | null | undefined): string {
  if (!maybeRelative) return '';
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
  if (!baseUrl) return maybeRelative;
  return `${baseUrl}${maybeRelative.startsWith('/') ? '' : '/'}${maybeRelative}`;
}

function resolveRunArtifactUrl(
  baseUrl: string,
  projectId: string,
  runId: string | undefined,
  maybeRelOrUrl: string | null | undefined
): string {
  if (!maybeRelOrUrl) return '';
  if (/^https?:\/\//i.test(maybeRelOrUrl)) return maybeRelOrUrl;
  if (maybeRelOrUrl.startsWith('/artifacts/')) {
    return resolveArtifactUrl(baseUrl, maybeRelOrUrl);
  }
  const effectiveRunId = runId || projectRunIds[projectId];
  if (!effectiveRunId) {
    return resolveArtifactUrl(baseUrl, maybeRelOrUrl);
  }
  const cleaned = maybeRelOrUrl.replace(/^\/+/, '');
  return resolveArtifactUrl(baseUrl, `/artifacts/${projectId}/runs/${effectiveRunId}/${cleaned}`);
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
  if (isDemoMode()) {
    throw new Error('DEMO_MODE_ACTIVE');
  }
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    throw new ApiHttpError(
      0,
      'Backend API URL is not configured. Set the FastAPI URL in Settings or switch to Demo Mode.',
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
          if (typeof parsed.retryable === 'boolean') retryable = parsed.retryable;
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
  const qualityMode = (raw.quality_mode ?? raw.qualityMode ?? 'atelier') as Project['qualityMode'];
  const thumbMap: Record<Project['category'], string> = {
    living: STITCH_IMAGES.scanPreviewLiving,
    kitchen: STITCH_IMAGES.scandiKitchen,
    bedroom: STITCH_IMAGES.bedroomLoft,
  };
  return {
    id: raw.id,
    name: raw.name,
    category,
    categoryLabel: raw.categoryLabel ?? `${category.toUpperCase()} • ${status}`,
    status,
    progress: raw.progress ?? 0,
    estimatedMinutesLeft: raw.estimatedMinutesLeft,
    areaSqm: raw.areaSqm ?? 0,
    dimensionsLabel: raw.dimensionsLabel ?? (raw.gaussian_count ? 'Measured 3D Room' : 'Pending Capture'),
    qualityBadge:
      raw.qualityBadge ??
      (qualityMode === 'atelier' ? 'Atelier • 960px' : 'Sketch • 640px'),
    qualityMode,
    scannedAtLabel:
      raw.scannedAtLabel ??
      (status === 'ready' ? 'Ready' : status === 'processing' ? 'In Progress' : status === 'failed' ? 'Failed' : 'Draft'),
    createdAt: raw.created_at ?? raw.createdAt ?? new Date().toISOString(),
    description: raw.description ?? '',
    thumbnailUrl: raw.thumbnailUrl ?? thumbMap[category],
    frameCount: raw.frame_count ?? raw.frameCount ?? undefined,
    splatCountLabel:
      raw.splatCountLabel ??
      (raw.gaussian_count ? `${Number(raw.gaussian_count).toLocaleString()} Gaussians` : undefined),
    taskId: raw.active_task_id ?? raw.taskId ?? undefined,
    videoFileName: raw.video_filename ?? raw.videoFileName ?? undefined,
    videoReady: raw.video_ready ?? raw.videoReady,
    videoDurationSec: raw.video_duration_sec ?? raw.videoDurationSec,
    videoWidth: raw.video_width ?? raw.videoWidth,
    videoHeight: raw.video_height ?? raw.videoHeight,
    hasRestyle: Boolean(raw.has_edited_scene ?? raw.hasRestyle),
    activeSceneVersion: raw.active_scene_version ?? raw.activeSceneVersion,
    hasEditedScene: raw.has_edited_scene ?? raw.hasEditedScene,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBackendTask(raw: any): ReconstructionTask {
  return {
    id: raw.id,
    projectId: raw.project_id ?? raw.projectId,
    runId: raw.run_id ?? raw.runId,
    taskType: raw.task_type ?? raw.taskType ?? 'reconstruction',
    projectName: raw.projectName ?? raw.project_name ?? raw.project_id ?? 'Room Scan',
    scanBadge: raw.scanBadge ?? `RUN ${(raw.run_id ?? raw.id ?? '').slice(-6).toUpperCase()}`,
    status: raw.status,
    stage: raw.stage,
    progress: raw.progress ?? 0,
    estimatedMinutes:
      raw.estimatedMinutes ?? Math.max(1, Math.ceil((100 - (raw.progress ?? 0)) / 25)),
    substepMessage: raw.substep_message ?? raw.substepMessage ?? '',
    error: raw.error ?? null,
    fps: raw.fps ?? 2,
    maxLongSide: (raw.max_long_side ?? raw.maxLongSide ?? 960) as 640 | 768 | 960,
    dropBlurry: raw.drop_blurry ?? raw.dropBlurry ?? true,
    poseEstimator: raw.pose_estimator ?? raw.poseEstimator ?? 'GLOMAP',
    extractedFrames: raw.extracted_frames ?? raw.extractedFrames ?? 0,
    droppedFrames: raw.dropped_frames ?? raw.droppedFrames ?? 0,
    registeredFrames: raw.registered_frames ?? raw.registeredFrames ?? 0,
    iterationsDone: raw.iterations_done ?? raw.iterationsDone ?? 0,
    iterationsTotal: raw.iterations_total ?? raw.iterationsTotal ?? 15000,
    gaussiansCount: raw.gaussians_count ?? raw.gaussiansCount ?? 0,
    peakVramGb: raw.peak_vram_gb ?? raw.peakVramGb ?? 0,
    wallTimeSec: raw.wall_time_sec ?? raw.wallTimeSec ?? 0,
    logs: Array.isArray(raw.logs) ? raw.logs : [],
    editId: raw.edit_id ?? raw.editId ?? null,
    createdAt: raw.created_at ?? raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updated_at ?? raw.updatedAt,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBackendScene(raw: any, baseUrl: string, project: Project): SceneData {
  if (raw.splatUrl && raw.sampledFrames) {
    return raw as SceneData;
  }
  const vt = raw.viewer_transform;
  const versions: SceneData['versions'] = {};
  if (raw.versions) {
    for (const key of ['original', 'edited'] as const) {
      const v = raw.versions[key];
      if (v) {
        versions[key] = {
          versionId: v.version_id,
          kind: v.kind,
          runId: v.run_id,
          splatUrl: resolveArtifactUrl(baseUrl, v.splat_url),
          plyUrl: v.ply_url ? resolveArtifactUrl(baseUrl, v.ply_url) : null,
          sparseCloudUrl: v.sparse_cloud_url ? resolveArtifactUrl(baseUrl, v.sparse_cloud_url) : null,
          gaussianCount: v.gaussian_count,
          rebuildMode: v.rebuild_mode,
          editId: v.edit_id ?? null,
          acceptedPreviewId: v.accepted_preview_id ?? null,
          createdAt: v.created_at,
        };
      }
    }
  }

  // W8 edits/masks/previews live under the original run_id
  const originalRunId = versions.original?.runId || raw.run_id;
  if (originalRunId) {
    projectRunIds[raw.project_id ?? project.id] = originalRunId;
  }

  const sampledFrames: SampledFrame[] = Array.isArray(raw.sampled_frames)
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      raw.sampled_frames.map((f: any) => {
        const sec = Number(f.timestamp_sec ?? 0);
        const mins = Math.floor(sec / 60);
        const rem = Math.floor(sec % 60);
        const w = Number(f.width || 960);
        const h = Number(f.height || 540);
        const bb = f.bounding_box_px;
        return {
          id: f.frame_id,
          index: f.frame_index,
          timestampLabel: `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`,
          timestampSec: sec,
          width: w,
          height: h,
          imageUrl: resolveArtifactUrl(baseUrl, f.image_url),
          registered: Boolean(f.registered),
          droppedReason: f.dropped_reason ?? null,
          colmapImageId: f.colmap_image_id ?? null,
          cameraId: f.camera_id ?? null,
          cameraPose: f.camera_pose ?? null,
          hasObject: Boolean(f.has_object),
          includeInEdit: Boolean(f.include_in_edit),
          confidence: Number(f.confidence ?? 0),
          maskBox: bb
            ? {
                x: (bb.x_min / w) * 100,
                y: (bb.y_min / h) * 100,
                w: (bb.width / w) * 100,
                h: (bb.height / h) * 100,
              }
            : { x: 0, y: 0, w: 0, h: 0 },
          boundingBoxPx: bb
            ? { xMin: bb.x_min, yMin: bb.y_min, width: bb.width, height: bb.height }
            : null,
          maskUrl: f.mask_url ? resolveArtifactUrl(baseUrl, f.mask_url) : null,
          maskRevision: f.mask_revision ?? null,
          userMarked: Boolean(f.user_marked),
        };
      })
    : [];

  return {
    projectId: raw.project_id ?? project.id,
    runId: raw.run_id,
    activeVersion: raw.active_version ?? 'original',
    versions,
    splatUrl: resolveArtifactUrl(baseUrl, raw.splat_url),
    pointCloudUrl: resolveArtifactUrl(baseUrl, raw.point_cloud_url),
    manifestUrl: raw.manifest_url ? resolveArtifactUrl(baseUrl, raw.manifest_url) : null,
    viewerTransform: vt
      ? {
          colmapToThreejsMatrix: vt.colmap_to_threejs_matrix,
          sceneBoundsMin: vt.scene_bounds_min,
          sceneBoundsMax: vt.scene_bounds_max,
        }
      : undefined,
    roomDimensions: project.dimensionsLabel || 'Measured Scene',
    gaussianCount: raw.gaussian_count ?? 0,
    fpsTarget: 60,
    sunlightLabel: 'Captured Lighting',
    beforeImageUrl: sampledFrames[0]?.imageUrl || '',
    afterImageUrl: sampledFrames[0]?.imageUrl || '',
    cameraPoses: raw.camera_poses ?? [],
    cameraPath: Array.isArray(raw.camera_path)
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        raw.camera_path.map((k: any) => ({
          position: k.position,
          target: k.target,
          durationMs: k.duration_ms ?? k.durationMs ?? 1200,
        }))
      : [],
    objects: [],
    sampledFrames,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBackendEditSession(raw: any, baseUrl: string, runId?: string): EditSessionDTO {
  const projectId = String(raw.project_id ?? '');
  const effectiveRunId = runId || projectRunIds[projectId];
  const reviewedFrames: FrameMaskRecordDTO[] = Array.isArray(raw.reviewed_frames)
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      raw.reviewed_frames.map((rf: any) => ({
        frameId: rf.frame_id,
        maskRevision: Number(rf.mask_revision ?? 1),
        maskUrl: rf.mask_relative_path
          ? resolveRunArtifactUrl(baseUrl, projectId, effectiveRunId, rf.mask_relative_path)
          : null,
        hasObject: Boolean(rf.has_object),
        includeInEdit: Boolean(rf.include_in_edit),
        userMarked: Boolean(rf.user_marked),
        clicks: Array.isArray(rf.clicks) ? rf.clicks : [],
        confidence: rf.confidence ?? null,
        boundingBoxPx: rf.bounding_box_px
          ? {
              xMin: rf.bounding_box_px.x_min,
              yMin: rf.bounding_box_px.y_min,
              width: rf.bounding_box_px.width,
              height: rf.bounding_box_px.height,
            }
          : null,
      }))
    : [];

  return {
    editId: raw.edit_id,
    projectId,
    prompt: raw.prompt ?? '',
    referenceFrameId: raw.reference_frame_id ?? null,
    currentMaskRevision: raw.current_mask_revision ?? 0,
    acceptedPreviewId: raw.accepted_preview_id ?? null,
    acceptanceValid: Boolean(raw.acceptance_valid),
    acceptanceInvalidated: Boolean(raw.acceptance_invalidated),
    previews: Array.isArray(raw.previews)
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        raw.previews.map((p: any): PreviewVariantDTO => ({
          previewId: p.preview_id,
          seed: p.seed,
          prompt: p.prompt,
          referenceFrameId: p.reference_frame_id,
          maskRevision: p.mask_revision,
          previewImageUrl: resolveRunArtifactUrl(
            baseUrl,
            projectId,
            effectiveRunId,
            p.preview_relative_path ?? p.preview_image_url
          ),
          createdAt: p.created_at,
          precision: p.precision ?? null,
          peakVramGb: p.peak_vram_gb ?? null,
          elapsedSec: p.elapsed_sec ?? null,
        }))
      : [],
    reviewedFrames,
    trackingTaskId: raw.tracking_task_id ?? null,
    batchEditTaskId: raw.batch_edit_task_id ?? null,
    rebuildTaskId: raw.rebuild_task_id ?? null,
    updatedAt: raw.updated_at,
  };
}

export interface AuthResponse {
  user: UserProfile;
  token: string;
  mode: 'backend' | 'local';
}

export const api = {
  async testConnection(url: string): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const trimmed = url.trim().replace(/\/+$/, '') || getApiBaseUrl();
    const start = performance.now();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4500);
    try {
      const headers = buildAuthHeaders();
      const healthRes = await fetch(`${trimmed}/health`, { headers, signal: controller.signal });
      const projRes = await fetch(`${trimmed}/projects`, { headers, signal: controller.signal });
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
        message: 'Backend unreachable from browser — verify uvicorn / tunnel is running.',
        latencyMs,
      };
    } finally {
      window.clearTimeout(timer);
    }
  },

  async login(email: string, password: string, remember = true): Promise<AuthResponse> {
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

  async changePassword(currentPassword: string, newPassword: string): Promise<AuthResponse> {
    const data = await fetchLive<AuthResponse & { ok?: boolean }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const storageTarget = localStorage.getItem(STORAGE_KEYS.token) !== null ? 'local' : 'session';
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

  async resetPassword(token: string, newPassword: string): Promise<{ ok: boolean }> {
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
    if (isDemoMode()) {
      const token = `demo-share-${projectId}`;
      return {
        shareId: `shr-${Date.now().toString(36)}`,
        projectId,
        label,
        shareToken: token,
        sharePath: `/shared/${token}`,
        isActive: true,
        expiresAt: new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
      };
    }
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
    if (isDemoMode()) {
      return [];
    }
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
    if (isDemoMode()) return;
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
      res = await fetch(`${baseUrl}/shared/${encodeURIComponent(shareToken)}/scene`);
    } catch {
      throw new ApiHttpError(0, 'Unable to reach AuraSpace backend.', 'NETWORK_UNREACHABLE', true);
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
      dimensionsLabel: 'Measured 3D Room',
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
    if (isDemoMode()) {
      return safeReadJson<Project[]>(STORAGE_KEYS.projects, INITIAL_PROJECTS);
    }
    const data = await fetchLive<unknown[]>('/projects');
    return data.map(mapBackendProject);
  },

  async getProject(projectId: string): Promise<Project> {
    if (isDemoMode()) {
      const existing = safeReadJson<Project[]>(STORAGE_KEYS.projects, INITIAL_PROJECTS);
      const found = existing.find((p) => p.id === projectId);
      if (!found) throw new ApiHttpError(404, `Project ${projectId} not found`, 'NOT_FOUND', false);
      return found;
    }
    const raw = await fetchLive<unknown>(`/projects/${projectId}`);
    return mapBackendProject(raw);
  },

  async createProject(config: VideoConstraintsConfig): Promise<Project> {
    const categoryThumbMap: Record<Project['category'], string> = {
      living: STITCH_IMAGES.scanPreviewLiving,
      kitchen: STITCH_IMAGES.scandiKitchen,
      bedroom: STITCH_IMAGES.bedroomLoft,
    };
    const categoryLabelMap: Record<Project['category'], string> = {
      living: 'Living Room • Preparing 3D',
      kitchen: 'Kitchen & Dining • Preparing 3D',
      bedroom: 'Bedroom & Study • Preparing 3D',
    };
    const name = config.roomName.trim() || 'Untitled Space';
    const description = `${config.videoFileName} (${config.fps} fps, ${config.maxLongSide}px max side${
      config.dropBlurryFrames ? ', blur filtered' : ''
    }).`;

    if (isDemoMode()) {
      const localProject: Project = {
        id: `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        name,
        category: config.category,
        categoryLabel: categoryLabelMap[config.category],
        status: 'draft',
        progress: 0,
        estimatedMinutesLeft: config.qualityMode === 'atelier' ? 4 : 2,
        areaSqm: 38,
        dimensionsLabel: config.autoDimensions ? '4.6m × 5.1m' : 'Unscaled',
        qualityBadge:
          config.qualityMode === 'atelier' ? 'Atelier Studio • 960px' : 'Fast Sketch • 640px',
        qualityMode: config.qualityMode,
        scannedAtLabel: 'Just Uploaded',
        createdAt: new Date().toISOString(),
        description,
        thumbnailUrl: categoryThumbMap[config.category],
        frameCount: Math.max(24, Math.round(config.videoDurationSec * config.fps)),
        videoFileName: config.videoFileName,
      };
      const existing = safeReadJson<Project[]>(STORAGE_KEYS.projects, INITIAL_PROJECTS);
      safeWriteJson(STORAGE_KEYS.projects, [localProject, ...existing]);
      return localProject;
    }

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
    if (isDemoMode()) {
      const existing = safeReadJson<Project[]>(STORAGE_KEYS.projects, INITIAL_PROJECTS);
      safeWriteJson(
        STORAGE_KEYS.projects,
        existing.filter((p) => p.id !== projectId)
      );
      return;
    }
    await fetchLive<void>(`/projects/${projectId}`, { method: 'DELETE' });
  },

  async uploadVideo(
    projectId: string,
    file: File | null,
    constraints: VideoConstraintsConfig
  ): Promise<{ uploaded: boolean; frameEstimate: number; details?: VideoUploadResponse }> {
    if (isDemoMode() && !file) {
      return {
        uploaded: true,
        frameEstimate: Math.max(30, Math.round(constraints.videoDurationSec * constraints.fps)),
      };
    }
    if (!file) {
      throw new ApiHttpError(
        400,
        'A real room walkthrough video file (.mp4, .mov, .webm) is required in Live Mode.',
        'VIDEO_FILE_REQUIRED',
        true
      );
    }

    if (isDemoMode()) {
      return {
        uploaded: true,
        frameEstimate: Math.max(30, Math.round(constraints.videoDurationSec * constraints.fps)),
      };
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
    const maxLongSide = constraints?.maxLongSide ?? settings.defaultMaxResolution;
    const dropBlurry = constraints?.dropBlurryFrames ?? true;

    if (isDemoMode()) {
      const frames = project.frameCount ?? 240;
      const uid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const localTask: ReconstructionTask = {
        id: `task-${uid}`,
        projectId: project.id,
        projectName: project.name,
        scanBadge: `SUNLIT SCAN #${uid.slice(-4).toUpperCase()}`,
        status: 'running',
        stage: 'extracting_frames',
        progress: 8,
        estimatedMinutes: project.qualityMode === 'atelier' ? 4 : 2,
        substepMessage: `Extracting ${fps} fps frames (max ${maxLongSide}px) & filtering motion blur...`,
        error: null,
        fps,
        maxLongSide,
        dropBlurry,
        poseEstimator: settings.defaultPoseEstimator,
        extractedFrames: frames,
        registeredFrames: 0,
        iterationsDone: 0,
        iterationsTotal: project.qualityMode === 'atelier' ? 15000 : 7000,
        gaussiansCount: 0,
        peakVramGb: 4.2,
        logs: [
          `[00:01] Demo sandbox picked up task for "${project.name}"`,
          `[00:02] Simulated ffmpeg extraction @ ${fps} fps, max ${maxLongSide}px`,
        ],
        createdAt: new Date().toISOString(),
      };
      const tasks = safeReadJson<Record<string, ReconstructionTask>>(
        STORAGE_KEYS.tasks,
        INITIAL_TASKS
      );
      tasks[localTask.id] = localTask;
      safeWriteJson(STORAGE_KEYS.tasks, tasks);
      return localTask;
    }

    const remoteTask = await fetchLive<unknown>(`/projects/${project.id}/reconstruct`, {
      method: 'POST',
      body: JSON.stringify({
        fps,
        max_long_side: maxLongSide,
        drop_blurry: dropBlurry,
        pose_estimator: settings.defaultPoseEstimator,
        quality_mode: project.qualityMode,
      }),
    });
    const mapped = mapBackendTask(remoteTask);
    return { ...mapped, projectName: project.name };
  },

  async getTask(taskId: string): Promise<ReconstructionTask | null> {
    if (isDemoMode()) {
      const tasks = safeReadJson<Record<string, ReconstructionTask>>(
        STORAGE_KEYS.tasks,
        INITIAL_TASKS
      );
      return tasks[taskId] ?? null;
    }
    try {
      const raw = await fetchLive<unknown>(`/tasks/${taskId}`);
      return mapBackendTask(raw);
    } catch (err) {
      if (err instanceof ApiHttpError && (err.status === 404 || err.status === 403)) {
        return null;
      }
      throw err;
    }
  },

  async cancelTask(taskId: string): Promise<ReconstructionTask | null> {
    if (isDemoMode()) {
      return null;
    }
    const raw = await fetchLive<unknown>(`/tasks/${taskId}/cancel`, {
      method: 'POST',
    });
    return mapBackendTask(raw);
  },

  async getScene(project: Project): Promise<SceneData> {
    if (isDemoMode()) {
      return buildMockScene(project);
    }
    const baseUrl = getApiBaseUrl();
    const raw = await fetchLive<unknown>(`/projects/${project.id}/scene`);
    return mapBackendScene(raw, baseUrl, project);
  },

  // -------------------------------------------------------------------------
  // Week 8 Canonical Edit Contract Methods
  // -------------------------------------------------------------------------

  async listEditSessions(projectId: string, runId?: string): Promise<EditSessionDTO[]> {
    if (isDemoMode()) {
      const stored = safeReadJson<EditSessionDTO | null>(`auraspace_demo_edit_${projectId}`, null);
      return stored ? [stored] : [];
    }
    const baseUrl = getApiBaseUrl();
    const rows = await fetchLive<unknown[]>(`/projects/${projectId}/edits`);
    return rows.map((r) => mapBackendEditSession(r, baseUrl, runId));
  },

  async createEditSession(
    projectId: string,
    payload: { reference_frame_id?: string | null; prompt?: string } = {},
    runId?: string
  ): Promise<EditSessionDTO> {
    if (isDemoMode()) {
      const demo: EditSessionDTO = {
        editId: `edit-demo-${Date.now().toString(36)}`,
        projectId,
        prompt: payload.prompt ?? '',
        referenceFrameId: payload.reference_frame_id ?? null,
        currentMaskRevision: 0,
        acceptedPreviewId: null,
        acceptanceValid: false,
        acceptanceInvalidated: false,
        previews: [],
        reviewedFrames: [],
        updatedAt: new Date().toISOString(),
      };
      safeWriteJson(`auraspace_demo_edit_${projectId}`, demo);
      return demo;
    }
    const baseUrl = getApiBaseUrl();
    const raw = await fetchLive<unknown>(`/projects/${projectId}/edits`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return mapBackendEditSession(raw, baseUrl, runId);
  },

  async getEditSession(projectId: string, editId: string, runId?: string): Promise<EditSessionDTO> {
    if (isDemoMode()) {
      const stored = safeReadJson<EditSessionDTO | null>(`auraspace_demo_edit_${projectId}`, null);
      if (stored && stored.editId === editId) return stored;
      throw new ApiHttpError(404, `Demo edit session ${editId} not found`, 'NOT_FOUND', false);
    }
    const baseUrl = getApiBaseUrl();
    const raw = await fetchLive<unknown>(`/projects/${projectId}/edits/${editId}`);
    return mapBackendEditSession(raw, baseUrl, runId);
  },

  async updateEditSession(
    projectId: string,
    editId: string,
    payload: { prompt?: string; reference_frame_id?: string | null },
    runId?: string
  ): Promise<EditSessionDTO> {
    if (isDemoMode()) {
      const stored = safeReadJson<EditSessionDTO | null>(`auraspace_demo_edit_${projectId}`, null);
      const updated: EditSessionDTO = {
        ...(stored || {
          editId,
          projectId,
          prompt: '',
          referenceFrameId: null,
          currentMaskRevision: 0,
          acceptedPreviewId: null,
          acceptanceValid: false,
          acceptanceInvalidated: false,
          previews: [],
          reviewedFrames: [],
          updatedAt: new Date().toISOString(),
        }),
        prompt: payload.prompt ?? stored?.prompt ?? '',
        referenceFrameId:
          payload.reference_frame_id !== undefined
            ? payload.reference_frame_id
            : stored?.referenceFrameId ?? null,
        acceptedPreviewId: null,
        acceptanceValid: false,
        acceptanceInvalidated: Boolean(stored?.acceptedPreviewId),
        updatedAt: new Date().toISOString(),
      };
      safeWriteJson(`auraspace_demo_edit_${projectId}`, updated);
      return updated;
    }
    const baseUrl = getApiBaseUrl();
    const raw = await fetchLive<unknown>(`/projects/${projectId}/edits/${editId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return mapBackendEditSession(raw, baseUrl, runId);
  },

  async restoreLatestEditSession(
    projectId: string,
    manifestUrl?: string | null,
    runId?: string
  ): Promise<EditSessionDTO | null> {
    if (isDemoMode()) {
      return safeReadJson<EditSessionDTO | null>(`auraspace_demo_edit_${projectId}`, null);
    }
    const baseUrl = getApiBaseUrl();
    let effectiveRunId = runId || projectRunIds[projectId];
    if (!effectiveRunId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawScene = await fetchLive<any>(`/projects/${projectId}/scene`);
        effectiveRunId = rawScene?.versions?.original?.run_id || rawScene?.run_id;
        if (effectiveRunId) projectRunIds[projectId] = effectiveRunId;
      } catch {
        // Ignore if scene not ready yet
      }
    }

    const sessions = await this.listEditSessions(projectId, effectiveRunId);
    if (sessions.length > 0) {
      return sessions[0];
    }

    if (manifestUrl) {
      try {
        const res = await fetch(resolveArtifactUrl(baseUrl, manifestUrl), {
          headers: buildAuthHeaders(),
        });
        if (res.ok) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const manifest = (await res.json()) as { edits?: Array<{ edit_id?: string }> };
          const lastEditId = manifest?.edits?.[manifest.edits.length - 1]?.edit_id;
          if (lastEditId) {
            return await this.getEditSession(projectId, lastEditId, effectiveRunId);
          }
        }
      } catch {
        // Ignore manifest fallback error
      }
    }
    return null;
  },

  async segmentWithPixelClicks(
    projectId: string,
    editId: string,
    frameId: string,
    clicks: PixelClick[]
  ): Promise<SegmentResult> {
    if (isDemoMode()) {
      return {
        editId,
        frameId,
        maskRevision: 1,
        maskUrl: '',
        maskConfidence: 0.94,
        pixelAreaPct: 24,
        boundingBox: { x: 260, y: 180, w: 320, h: 210 },
        boundingBoxPx: { xMin: 260, yMin: 180, width: 320, height: 210 },
        acceptanceInvalidated: false,
      };
    }
    const baseUrl = getApiBaseUrl();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await fetchLive<any>(`/projects/${projectId}/edits/${editId}/segment`, {
      method: 'POST',
      body: JSON.stringify({ frame_id: frameId, clicks }),
    });
    const bb = raw.bounding_box_px;
    return {
      editId: raw.edit_id,
      frameId: raw.frame_id,
      maskRevision: raw.mask_revision,
      maskUrl: resolveArtifactUrl(baseUrl, raw.mask_url),
      maskConfidence: raw.confidence,
      pixelAreaPct: raw.pixel_area_pct,
      boundingBox: bb
        ? { x: bb.x_min, y: bb.y_min, w: bb.width, h: bb.height }
        : { x: 0, y: 0, w: 0, h: 0 },
      boundingBoxPx: bb
        ? { xMin: bb.x_min, yMin: bb.y_min, width: bb.width, height: bb.height }
        : undefined,
      acceptanceInvalidated: Boolean(raw.acceptance_invalidated),
    };
  },

  async startEditTracking(
    projectId: string,
    editId: string,
    referenceFrameId: string,
    maskRevision: number,
    frameIds?: string[]
  ): Promise<ReconstructionTask> {
    const raw = await fetchLive<unknown>(`/projects/${projectId}/edits/${editId}/track`, {
      method: 'POST',
      body: JSON.stringify({
        reference_frame_id: referenceFrameId,
        mask_revision: maskRevision,
        frame_ids: frameIds ?? null,
      }),
    });
    return mapBackendTask(raw);
  },

  async saveReviewedFrames(
    projectId: string,
    editId: string,
    decisions: ReviewedFrameDecision[],
    runId?: string
  ): Promise<EditSessionDTO> {
    const baseUrl = getApiBaseUrl();
    const raw = await fetchLive<unknown>(`/projects/${projectId}/edits/${editId}/frames`, {
      method: 'PUT',
      body: JSON.stringify({ decisions }),
    });
    return mapBackendEditSession(raw, baseUrl, runId);
  },

  async generatePreviewVariant(
    projectId: string,
    editId: string,
    referenceFrameId: string,
    prompt: string,
    seed?: number,
    runId?: string
  ): Promise<PreviewVariantDTO> {
    const baseUrl = getApiBaseUrl();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await fetchLive<any>(`/projects/${projectId}/edits/${editId}/preview`, {
      method: 'POST',
      body: JSON.stringify({
        reference_frame_id: referenceFrameId,
        prompt,
        seed: seed ?? null,
      }),
    });
    return {
      previewId: raw.preview_id,
      seed: raw.seed,
      prompt: raw.prompt,
      referenceFrameId: raw.reference_frame_id,
      maskRevision: raw.mask_revision,
      previewImageUrl: resolveRunArtifactUrl(
        baseUrl,
        projectId,
        runId,
        raw.preview_relative_path ?? raw.preview_image_url
      ),
      createdAt: raw.created_at,
      precision: raw.precision ?? null,
      peakVramGb: raw.peak_vram_gb ?? null,
      elapsedSec: raw.elapsed_sec ?? null,
    };
  },

  async acceptPreview(
    projectId: string,
    editId: string,
    previewId: string,
    runId?: string
  ): Promise<EditSessionDTO> {
    const baseUrl = getApiBaseUrl();
    const raw = await fetchLive<unknown>(
      `/projects/${projectId}/edits/${editId}/accept-preview`,
      {
        method: 'POST',
        body: JSON.stringify({ preview_id: previewId }),
      }
    );
    return mapBackendEditSession(raw, baseUrl, runId);
  },

  async startBatchEdit(
    projectId: string,
    editId: string,
    acceptedPreviewId: string
  ): Promise<ReconstructionTask> {
    const raw = await fetchLive<unknown>(
      `/projects/${projectId}/edits/${editId}/batch-edit`,
      {
        method: 'POST',
        body: JSON.stringify({ accepted_preview_id: acceptedPreviewId }),
      }
    );
    return mapBackendTask(raw);
  },

  async startRebuild(
    projectId: string,
    editId: string,
    acceptedPreviewId: string,
    mode: 'finetune' | 'scratch' = 'finetune'
  ): Promise<ReconstructionTask> {
    const raw = await fetchLive<unknown>(
      `/projects/${projectId}/edits/${editId}/rebuild`,
      {
        method: 'POST',
        body: JSON.stringify({ mode, accepted_preview_id: acceptedPreviewId }),
      }
    );
    return mapBackendTask(raw);
  },

  // -------------------------------------------------------------------------
  // Legacy Studio wrappers (explicit Demo Mode vs Live error; updated by A10)
  // -------------------------------------------------------------------------

  async segmentObject(
    projectId: string,
    frameId: string,
    points: MaskPoint[]
  ): Promise<{
    maskConfidence: number;
    pixelAreaPct: number;
    boundingBox: { x: number; y: number; w: number; h: number };
  }> {
    if (!isDemoMode()) {
      return await fetchLive(`/projects/${projectId}/segment`, {
        method: 'POST',
        body: JSON.stringify({ frame_id: frameId, points }),
      });
    }
    const posCount = points.filter((p) => p.type === 'positive').length;
    const negCount = points.filter((p) => p.type === 'negative').length;
    return {
      maskConfidence: Math.min(0.99, 0.89 + posCount * 0.02 - negCount * 0.01),
      pixelAreaPct: Math.max(8, 22 + posCount * 2 - negCount * 2),
      boundingBox: { x: 34, y: 38, w: 24, h: 36 },
    };
  },

  async trackObjectAcrossFrames(
    projectId: string,
    frames: SampledFrame[]
  ): Promise<SampledFrame[]> {
    if (!isDemoMode()) {
      return await fetchLive<SampledFrame[]>(`/projects/${projectId}/track`, {
        method: 'POST',
        body: JSON.stringify({ frame_ids: frames.map((f) => f.id) }),
      });
    }
    return frames.map((f) => ({
      ...f,
      userMarked: f.hasObject,
    }));
  },

  async generateDiffusionPreview(
    projectId: string,
    prompt: string,
    seed?: number
  ): Promise<DiffusionPreviewResult> {
    const chosenSeed = seed ?? Math.floor(10000 + Math.random() * 89999);
    if (!isDemoMode()) {
      return await fetchLive<DiffusionPreviewResult>(`/projects/${projectId}/edit`, {
        method: 'POST',
        body: JSON.stringify({ prompt, seed: chosenSeed }),
      });
    }
    const lower = prompt.toLowerCase();
    let colorHex = '#8A4325';
    let materialLabel = 'Cognac Italian Leather';
    let previewImageUrl = STITCH_IMAGES.cognacPreview;

    if (lower.includes('green') || lower.includes('emerald') || lower.includes('olive')) {
      colorHex = '#2E4C3B';
      materialLabel = 'Deep Emerald Leather';
      previewImageUrl = STITCH_IMAGES.bohemianLiving;
    } else if (lower.includes('boucl') || lower.includes('cream') || lower.includes('white')) {
      colorHex = '#EDE4D7';
      materialLabel = 'Warm Ivory Bouclé';
      previewImageUrl = STITCH_IMAGES.signupShowcase;
    } else if (lower.includes('walnut') || lower.includes('oak') || lower.includes('scandi')) {
      colorHex = '#7C5438';
      materialLabel = 'Smoked Walnut & Linen';
      previewImageUrl = STITCH_IMAGES.armchairFocus;
    } else if (lower.includes('charcoal') || lower.includes('black') || lower.includes('slate')) {
      colorHex = '#383431';
      materialLabel = 'Charcoal Velvet Matte';
      previewImageUrl = STITCH_IMAGES.industrialLoft;
    }

    return {
      seed: chosenSeed,
      prompt,
      previewImageUrl,
      colorHex,
      materialLabel,
      calibratingNotes: `Seed #${chosenSeed} • Demo Sandbox preview`,
    };
  },
};
