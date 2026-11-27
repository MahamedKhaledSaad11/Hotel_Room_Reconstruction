export type UserPracticeRole =
  | 'Interior Designer'
  | 'Architect'
  | 'Homeowner / Enthusiast'
  | '3D Stylist';

export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  title: string;
  studioName: string;
  practiceFocus: string;
  role: UserPracticeRole;
  accountRole?: 'member' | 'admin';
  permissions?: string[];
  avatarUrl: string;
  licenseId: string;
  location: string;
  memberSince: string;
  primaryRig: string;
}

export interface ProjectShareDTO {
  shareId: string;
  projectId: string;
  label: string;
  shareToken?: string;
  sharePath?: string;
  isActive: boolean;
  expiresAt: string;
  revokedAt?: string | null;
  createdAt: string;
}

export interface ForgotPasswordResponse {
  ok: boolean;
  message: string;
  devResetToken?: string;
}

export type ProjectCategory = 'living' | 'kitchen' | 'bedroom';
export type ProjectStatus = 'ready' | 'processing' | 'draft' | 'failed';
export type QualityMode = 'atelier' | 'sketch';

export interface Project {
  id: string;
  name: string;
  category: ProjectCategory;
  categoryLabel: string;
  status: ProjectStatus;
  progress: number;
  estimatedMinutesLeft?: number;
  areaSqm: number;
  dimensionsLabel: string;
  qualityBadge: string;
  qualityMode: QualityMode;
  scannedAtLabel: string;
  createdAt: string;
  description: string;
  thumbnailUrl: string;
  frameCount?: number;
  splatCountLabel?: string;
  taskId?: string;
  videoFileName?: string;
  videoReady?: boolean;
  videoDurationSec?: number;
  videoWidth?: number;
  videoHeight?: number;
}

export type PipelineStageId =
  | 'extracting_frames'
  | 'estimating_poses'
  | 'training_3dgs'
  | 'exporting_splat';

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'error';

export type TaskType = 'reconstruction';

export interface StageDetail {
  id: PipelineStageId;
  stepNumber: string;
  humanTitle: string;
  technicalStage: string;
  description: string;
  metricLabel: string;
  icon: string;
  status: 'pending' | 'active' | 'completed';
}

export interface ReconstructionTask {
  id: string;
  projectId: string;
  runId?: string;
  taskType?: TaskType;
  projectName: string;
  scanBadge: string;
  status: TaskStatus;
  stage: PipelineStageId;
  progress: number; // 0 - 100
  estimatedMinutes: number;
  substepMessage: string;
  error: string | null;
  fps: number;
  maxLongSide: 640 | 768 | 960;
  dropBlurry: boolean;
  poseEstimator: 'GLOMAP' | 'VGGT';
  // Backend-measured fields
  extractedFrames: number;
  droppedFrames?: number;
  registeredFrames: number;
  iterationsDone: number;
  iterationsTotal: number;
  gaussiansCount: number;
  peakVramGb: number;
  wallTimeSec?: number;
  logs: string[];
  createdAt: string;
  updatedAt?: string;
}

export interface CameraPose {
  id: string;
  label: string;
  frameId?: string | null;
  coordinateSpace?: 'colmap' | 'threejs';
  up?: [number, number, number];
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
}

export interface ViewerTransform {
  colmapToThreejsMatrix: number[][];
  sceneBoundsMin: [number, number, number];
  sceneBoundsMax: [number, number, number];
}

export interface SceneData {
  projectId: string;
  runId?: string;
  splatUrl: string;
  pointCloudUrl: string;
  manifestUrl?: string | null;
  viewerTransform?: ViewerTransform;
  gaussianCount: number;
  cameraPoses: CameraPose[];
}

export interface SharedSceneData extends SceneData {
  projectName: string;
  shareLabel: string;
  readOnly: boolean;
}

export interface VideoUploadResponse {
  projectId: string;
  uploaded: boolean;
  videoFilename: string;
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  sourceFps: number;
  fps: number;
  maxLongSide: number;
  dropBlurry: boolean;
  frameEstimate: number;
  sha256: string;
}

export interface AtelierSettings {
  apiBaseUrl: string;
  demoMode?: boolean;
  defaultPoseEstimator: 'GLOMAP' | 'VGGT';
  defaultMaxResolution: 640 | 768 | 960;
}

export interface VideoConstraintsConfig {
  roomName: string;
  category: ProjectCategory;
  qualityMode: QualityMode;
  fps: 1 | 2 | 3 | 4;
  maxLongSide: 640 | 768 | 960;
  dropBlurryFrames: boolean;
  videoFileName: string;
  videoDurationSec: number;
  videoWidth: number;
  videoHeight: number;
  videoSizeMb: number;
}
