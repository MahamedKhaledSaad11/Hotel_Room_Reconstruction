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
  hasRestyle?: boolean;
  restyledObjectLabel?: string;
  activeSceneVersion?: 'original' | 'edited';
  hasEditedScene?: boolean;
}

export type PipelineStageId =
  | 'extracting_frames'
  | 'estimating_poses'
  | 'training_3dgs'
  | 'exporting_splat';

export type W8StageId =
  | 'tracking'
  | 'previewing'
  | 'batch_editing'
  | 'rebuilding';

export type AnyTaskStageId = PipelineStageId | W8StageId;

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'error';

export type TaskType =
  | 'reconstruction'
  | 'tracking'
  | 'preview'
  | 'batch_edit'
  | 'rebuild';

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
  w8Stage?: W8StageId;
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
  editId?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface CameraPose {
  id: string;
  label: string;
  frameId?: string | null;
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
}

export interface CameraPathKeyframe {
  position: [number, number, number];
  target: [number, number, number];
  durationMs: number;
}

export interface ViewerTransform {
  colmapToThreejsMatrix: number[][];
  sceneBoundsMin: [number, number, number];
  sceneBoundsMax: [number, number, number];
}

export interface BoundingBoxPx {
  xMin: number;
  yMin: number;
  width: number;
  height: number;
}

export type RebuildMode = 'initial' | 'finetune' | 'scratch';

export interface SceneVersionDTO {
  versionId: string;
  kind: 'original' | 'edited';
  runId: string;
  splatUrl: string;
  plyUrl?: string | null;
  sparseCloudUrl?: string | null;
  gaussianCount: number;
  rebuildMode: RebuildMode;
  editId?: string | null;
  acceptedPreviewId?: string | null;
  createdAt: string;
}

export interface SceneObjectInfo {
  id: string;
  label: string;
  shortName: string;
  category: string;
  defaultPrompt: string;
  previewImageUrl: string;
  screenAnchor: { x: number; y: number };
  worldBoundsCenter: [number, number, number];
}

export interface SampledFrame {
  id: string;
  index: number;
  timestampLabel: string;
  timestampSec?: number;
  width?: number;
  height?: number;
  imageUrl: string;
  registered?: boolean;
  droppedReason?: string | null;
  colmapImageId?: number | null;
  cameraId?: number | null;
  cameraPose?: CameraPose | null;
  hasObject: boolean;
  includeInEdit?: boolean;
  confidence: number;
  maskBox: { x: number; y: number; w: number; h: number };
  boundingBoxPx?: BoundingBoxPx | null;
  maskUrl?: string | null;
  maskRevision?: number | null;
  userMarked: boolean;
}

export interface SceneData {
  projectId: string;
  runId?: string;
  activeVersion?: 'original' | 'edited';
  versions?: Partial<Record<'original' | 'edited', SceneVersionDTO>>;
  splatUrl: string;
  pointCloudUrl: string;
  manifestUrl?: string | null;
  viewerTransform?: ViewerTransform;
  roomDimensions: string;
  gaussianCount: number;
  fpsTarget: number;
  sunlightLabel: string;
  beforeImageUrl: string;
  afterImageUrl: string;
  cameraPoses: CameraPose[];
  cameraPath: CameraPathKeyframe[];
  objects: SceneObjectInfo[];
  sampledFrames: SampledFrame[];
}

export interface SharedSceneData extends SceneData {
  projectName: string;
  shareLabel: string;
  readOnly: boolean;
}

export interface MaskPoint {
  id: string;
  x: number; // percentage 0-100 (legacy UI) or pixel coordinate when pixelSpace=true
  y: number;
  xPx?: number;
  yPx?: number;
  type: 'positive' | 'negative';
  frameId: string;
}

export interface PixelClick {
  x_px: number;
  y_px: number;
  label: 'positive' | 'negative';
}

export interface SegmentResult {
  editId?: string;
  frameId: string;
  maskRevision: number;
  maskUrl: string;
  maskConfidence: number;
  pixelAreaPct: number;
  boundingBox: { x: number; y: number; w: number; h: number };
  boundingBoxPx?: BoundingBoxPx;
  acceptanceInvalidated?: boolean;
}

export interface PreviewVariantDTO {
  previewId: string;
  seed: number;
  prompt: string;
  referenceFrameId: string;
  maskRevision: number;
  previewImageUrl: string;
  createdAt: string;
  precision?: string | null;
  peakVramGb?: number | null;
  elapsedSec?: number | null;
}

export interface ReviewedFrameDecision {
  frame_id: string;
  include_in_edit: boolean;
  user_marked?: boolean;
  clicks?: PixelClick[] | null;
  rerun_segmentation?: boolean;
}

export interface FrameMaskRecordDTO {
  frameId: string;
  maskRevision: number;
  maskUrl: string | null;
  hasObject: boolean;
  includeInEdit: boolean;
  userMarked: boolean;
  clicks: PixelClick[];
  confidence: number | null;
  boundingBoxPx: BoundingBoxPx | null;
}

export interface EditSessionDTO {
  editId: string;
  projectId: string;
  prompt: string;
  referenceFrameId: string | null;
  currentMaskRevision: number;
  acceptedPreviewId: string | null;
  acceptanceValid: boolean;
  acceptanceInvalidated: boolean;
  previews: PreviewVariantDTO[];
  reviewedFrames?: FrameMaskRecordDTO[];
  trackingTaskId?: string | null;
  batchEditTaskId?: string | null;
  rebuildTaskId?: string | null;
  updatedAt: string;
}

export interface DiffusionPreviewResult {
  previewId?: string;
  maskRevision?: number;
  referenceFrameId?: string;
  seed: number;
  prompt: string;
  previewImageUrl: string;
  colorHex: string;
  materialLabel: string;
  calibratingNotes: string;
  precision?: string | null;
  peakVramGb?: number | null;
  elapsedSec?: number | null;
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
  unitSystem: 'metric' | 'imperial';
  autoDaylightSync: boolean;
  defaultPoseEstimator: 'GLOMAP' | 'VGGT';
  defaultMaxResolution: 640 | 768 | 960;
  notifyReconstructionComplete: boolean;
  notifyClientWalkthrough: boolean;
  biometricPasskeyEnabled: boolean;
  twoFactorEnabled: boolean;
}

export interface VideoConstraintsConfig {
  roomName: string;
  category: ProjectCategory;
  qualityMode: QualityMode;
  autoDimensions: boolean;
  fps: 1 | 2 | 3 | 4;
  maxLongSide: 640 | 768 | 960;
  dropBlurryFrames: boolean;
  videoFileName: string;
  videoDurationSec: number;
  videoWidth: number;
  videoHeight: number;
  videoSizeMb: number;
}
