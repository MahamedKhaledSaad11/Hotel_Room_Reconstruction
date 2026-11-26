import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AppHeader } from '../components/layout/AppHeader';
import { SafeImage } from '../components/common/SafeImage';
import {
  ArtifactImage,
  computeObjectContainBox,
  FrameMaskGridModal,
  mapClientClickToImagePixel,
  MaskOverlayCanvas,
  RenderedImageBox,
} from '../components/studio/FrameMaskGridModal';
import {
  ArtifactStatusInfo,
  CameraControlMode,
  ObjectOverrideStyle,
  SceneVersionKind,
  SplatRoomViewport,
  SplatViewportHandle,
  ViewportRenderMode,
} from '../components/studio/SplatRoomViewport';
import { AtelierModal } from '../components/modals/InfoModals';
import { useAuth } from '../context/AuthContext';
import { useProjects } from '../context/ProjectsContext';
import { useToast } from '../context/ToastContext';
import { STITCH_IMAGES } from '../data/mockData';
import { api } from '../services/api';
import {
  EditSessionDTO,
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
} from '../types';

const PROMPT_CHIPS = [
  'Make the sofa dark green leather',
  'Vintage Cognac Leather Club Chair',
  'Modern Bouclé Lounge Chair',
  'Minimalist Scandinavian Armchair',
];

function pixelsToMaskPoints(
  frameId: string,
  clicks: PixelClick[],
  width: number,
  height: number
): MaskPoint[] {
  const denomX = Math.max(1, width - 1);
  const denomY = Math.max(1, height - 1);
  return clicks.map((c, idx) => ({
    id: `pt-${frameId}-${idx}-${Math.round(c.x_px)}-${Math.round(c.y_px)}`,
    x: (c.x_px / denomX) * 100,
    y: (c.y_px / denomY) * 100,
    xPx: c.x_px,
    yPx: c.y_px,
    type: c.label,
    frameId,
  }));
}

function maskPointsToPixelClicks(
  points: MaskPoint[],
  width: number,
  height: number
): PixelClick[] {
  return points.map((pt) => {
    const xPx =
      pt.xPx !== undefined
        ? Math.min(width - 1, Math.max(0, pt.xPx))
        : Math.min(width - 1, Math.max(0, Math.round((pt.x / 100) * (width - 1))));
    const yPx =
      pt.yPx !== undefined
        ? Math.min(height - 1, Math.max(0, pt.yPx))
        : Math.min(height - 1, Math.max(0, Math.round((pt.y / 100) * (height - 1))));
    return {
      x_px: xPx,
      y_px: yPx,
      label: pt.type,
    };
  });
}

function hydrateFramesFromEdit(
  frames: SampledFrame[],
  reviewed: FrameMaskRecordDTO[] | undefined
): {
  nextFrames: SampledFrame[];
  pointsByFrame: Record<string, MaskPoint[]>;
} {
  const pointsByFrame: Record<string, MaskPoint[]> = {};
  if (!reviewed || reviewed.length === 0) {
    return { nextFrames: frames, pointsByFrame };
  }
  const byId = new Map(reviewed.map((r) => [r.frameId, r]));
  const nextFrames = frames.map((frame) => {
    const rec = byId.get(frame.id);
    if (!rec) return frame;
    const w = frame.width || 960;
    const h = frame.height || 540;
    if (rec.clicks && rec.clicks.length > 0) {
      pointsByFrame[frame.id] = pixelsToMaskPoints(frame.id, rec.clicks, w, h);
    }
    const bb = rec.boundingBoxPx;
    return {
      ...frame,
      hasObject: rec.hasObject,
      includeInEdit: rec.includeInEdit,
      userMarked: rec.userMarked,
      confidence: rec.confidence ?? frame.confidence,
      maskUrl: rec.maskUrl ?? frame.maskUrl,
      maskRevision: rec.maskRevision,
      boundingBoxPx: bb ?? frame.boundingBoxPx,
      maskBox: bb
        ? {
            x: (bb.xMin / w) * 100,
            y: (bb.yMin / h) * 100,
            w: (bb.width / w) * 100,
            h: (bb.height / h) * 100,
          }
        : frame.maskBox,
    };
  });
  return { nextFrames, pointsByFrame };
}

function deriveDemoMaterial(promptText: string): {
  colorHex: string;
  materialLabel: string;
  previewImageUrl: string;
} {
  const lower = promptText.toLowerCase();
  if (lower.includes('green') || lower.includes('emerald') || lower.includes('olive')) {
    return {
      colorHex: '#2E4C3B',
      materialLabel: 'Deep Emerald Leather',
      previewImageUrl: STITCH_IMAGES.bohemianLiving,
    };
  }
  if (lower.includes('boucl') || lower.includes('cream') || lower.includes('white')) {
    return {
      colorHex: '#EDE4D7',
      materialLabel: 'Warm Ivory Bouclé',
      previewImageUrl: STITCH_IMAGES.signupShowcase,
    };
  }
  if (lower.includes('walnut') || lower.includes('oak') || lower.includes('scandi')) {
    return {
      colorHex: '#7C5438',
      materialLabel: 'Smoked Walnut & Linen',
      previewImageUrl: STITCH_IMAGES.armchairFocus,
    };
  }
  if (lower.includes('charcoal') || lower.includes('black') || lower.includes('slate')) {
    return {
      colorHex: '#383431',
      materialLabel: 'Charcoal Velvet Matte',
      previewImageUrl: STITCH_IMAGES.industrialLoft,
    };
  }
  return {
    colorHex: '#8A4325',
    materialLabel: 'Cognac Italian Leather',
    previewImageUrl: STITCH_IMAGES.cognacPreview,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export const StudioPage: React.FC = () => {
  const { projectId } = useParams<{ projectId?: string }>();
  const [searchParams] = useSearchParams();
  const { demoMode, user } = useAuth();
  const { projects, markProjectRestyled, refreshProjects } = useProjects();
  const { showToast } = useToast();

  const canEdit = demoMode || Boolean(user.permissions?.includes('edit:write'));
  const canShare = demoMode || Boolean(user.permissions?.includes('project:share'));

  const [resolvedProject, setResolvedProject] = useState<Project | null>(null);
  const [studioLoading, setStudioLoading] = useState<boolean>(true);
  const [studioError, setStudioError] = useState<string | null>(null);

  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  const viewportRef = useRef<SplatViewportHandle | null>(null);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const frameStageRef = useRef<HTMLDivElement | null>(null);
  const jobTimersRef = useRef<number[]>([]);
  const mountedRef = useRef(true);

  const [sceneData, setSceneData] = useState<SceneData | null>(null);
  const [artifactStatus, setArtifactStatus] = useState<ArtifactStatusInfo | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraControlMode>('orbit');
  const [flySpeed, setFlySpeed] = useState<number>(1.5);
  const [renderMode, setRenderMode] = useState<ViewportRenderMode>('splat');
  const [sunAngleDeg, setSunAngleDeg] = useState<number>(38);
  const [fps, setFps] = useState<number>(60);
  const [pathPlaying, setPathPlaying] = useState<boolean>(false);

  // Edit Object / Week 2 states (per-frame prompts + explicit preview approval)
  const [drawerOpen, setDrawerOpen] = useState<boolean>(true);
  const [selectionSurface, setSelectionSurface] = useState<'3d' | 'frame'>('3d');
  const [selectedObjectId, setSelectedObjectId] = useState<string>('armchair');
  const [pointMode, setPointMode] = useState<'positive' | 'negative'>('positive');
  const [perFramePoints, setPerFramePoints] = useState<Record<string, MaskPoint[]>>({});
  const [maskConfidence, setMaskConfidence] = useState<number>(0);
  const [lastClickCoord, setLastClickCoord] = useState<{ label: string } | null>(null);
  const [segmenting, setSegmenting] = useState<boolean>(false);
  const [resegmentingFrameId, setResegmentingFrameId] = useState<string | null>(null);

  const [sampledFrames, setSampledFrames] = useState<SampledFrame[]>([]);
  const sampledFramesRef = useRef(sampledFrames);
  sampledFramesRef.current = sampledFrames;

  const [activeFrameId, setActiveFrameId] = useState<string>('');
  const [frameNaturalSize, setFrameNaturalSize] = useState<{ w: number; h: number }>({
    w: 960,
    h: 540,
  });
  const [frameRenderBox, setFrameRenderBox] = useState<RenderedImageBox>({
    width: 0,
    height: 0,
    offsetX: 0,
    offsetY: 0,
  });

  const [frameGridOpen, setFrameGridOpen] = useState<boolean>(false);
  const [reviewDirty, setReviewDirty] = useState<boolean>(false);
  const [savingReview, setSavingReview] = useState<boolean>(false);

  const [editSession, setEditSession] = useState<EditSessionDTO | null>(null);
  const editSessionRef = useRef<EditSessionDTO | null>(null);
  editSessionRef.current = editSession;

  const [prompt, setPrompt] = useState<string>('');
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(null);
  const [generatingPreview, setGeneratingPreview] = useState<boolean>(false);
  const [acceptingPreview, setAcceptingPreview] = useState<boolean>(false);

  // Tracking, Batch Diffusion & Rebuild worker progress
  const [trackingTask, setTrackingTask] = useState<ReconstructionTask | null>(null);
  const [batchTask, setBatchTask] = useState<ReconstructionTask | null>(null);
  const [rebuildTask, setRebuildTask] = useState<ReconstructionTask | null>(null);
  const [rebuildMode, setRebuildMode] = useState<'finetune' | 'scratch'>('finetune');
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [trackingPct, setTrackingPct] = useState<number>(0);
  const [rebuildStage, setRebuildStage] = useState<
    'idle' | 'diffusion' | 'rebuilding' | 'done' | 'error'
  >('idle');
  const [rebuildPct, setRebuildPct] = useState<number>(0);
  const [diffusionFrameIndex, setDiffusionFrameIndex] = useState<number>(0);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  // Camera-preserving Before/After scene version toggle (+ optional demo split view)
  const [activeSceneVersion, setActiveSceneVersion] = useState<SceneVersionKind>('original');
  const [beforeAfterActive, setBeforeAfterActive] = useState<boolean>(false);
  const [splitPct, setSplitPct] = useState<number>(50);
  const [draggingSplit, setDraggingSplit] = useState<boolean>(false);
  const [objectOverrides, setObjectOverrides] = useState<Record<string, ObjectOverrideStyle>>({});
  const [shareOpen, setShareOpen] = useState<boolean>(false);
  const [shareLabel, setShareLabel] = useState<string>('Client Walkthrough Link');
  const [shares, setShares] = useState<ProjectShareDTO[]>([]);
  const [sharesLoading, setSharesLoading] = useState<boolean>(false);
  const [creatingShare, setCreatingShare] = useState<boolean>(false);
  const [latestShareUrl, setLatestShareUrl] = useState<string>('');

  const clearJobTimers = useCallback(() => {
    jobTimersRef.current.forEach((id) => window.clearTimeout(id));
    jobTimersRef.current = [];
  }, []);

  useEffect(() => {
    if (!shareOpen || !resolvedProject || demoMode) return;
    let active = true;
    setSharesLoading(true);
    void api
      .listProjectShares(resolvedProject.id)
      .then((rows) => {
        if (active) setShares(rows);
      })
      .catch(() => {
        if (active) setShares([]);
      })
      .finally(() => {
        if (active) setSharesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [shareOpen, resolvedProject, demoMode]);

  const handleOpenShareModal = () => {
    if (!resolvedProject) return;
    setShareLabel('Client Walkthrough Link');
    setLatestShareUrl(
      demoMode ? `${window.location.origin}/studio/${resolvedProject.id}` : ''
    );
    setShares([]);
    setShareOpen(true);
  };

  const handleCreateAndCopyShare = async () => {
    if (!resolvedProject) return;
    if (demoMode) {
      const url = `${window.location.origin}/studio/${resolvedProject.id}`;
      setLatestShareUrl(url);
      try {
        await navigator.clipboard.writeText(url);
        showToast('Demo walkthrough link copied!', 'success');
      } catch {
        showToast(`Link ready: /studio/${resolvedProject.id}`, 'info');
      }
      return;
    }

    if (!canShare) {
      showToast('Share permission (project:share) is required.', 'warning');
      return;
    }

    setCreatingShare(true);
    try {
      const created = await api.createProjectShare(
        resolvedProject.id,
        shareLabel.trim() || 'Client Walkthrough Link',
        72
      );
      const url = `${window.location.origin}${created.sharePath || `/shared/${created.shareToken}`}`;
      setLatestShareUrl(url);
      setShares((prev) => [created, ...prev]);
      try {
        await navigator.clipboard.writeText(url);
        showToast('Revocable client share link created & copied!', 'success');
      } catch {
        showToast('Revocable client share link created!', 'success');
      }
    } catch (err) {
      showToast(
        err instanceof Error && err.message ? err.message : 'Unable to create share link.',
        'error'
      );
    } finally {
      setCreatingShare(false);
    }
  };

  const handleRevokeShare = async (shareId: string) => {
    if (!resolvedProject || !canShare) return;
    try {
      await api.revokeProjectShare(resolvedProject.id, shareId);
      setShares((prev) =>
        prev.map((s) => (s.shareId === shareId ? { ...s, isActive: false } : s))
      );
      showToast('Share link revoked', 'info');
    } catch (err) {
      showToast(
        err instanceof Error && err.message ? err.message : 'Unable to revoke share link.',
        'error'
      );
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearJobTimers();
    };
  }, [clearJobTimers]);

  useEffect(() => {
    if (searchParams.get('mode') === 'edit') {
      setDrawerOpen(true);
    }
  }, [searchParams]);

  const activeFrame = useMemo(
    () => sampledFrames.find((f) => f.id === activeFrameId) || sampledFrames[0] || null,
    [sampledFrames, activeFrameId]
  );

  const registeredFrames = useMemo(
    () => sampledFrames.filter((f) => f.registered !== false),
    [sampledFrames]
  );

  const activeFramePoints = useMemo(
    () => (activeFrameId ? perFramePoints[activeFrameId] ?? [] : []),
    [perFramePoints, activeFrameId]
  );

  const displayedPreview: PreviewVariantDTO | null = useMemo(() => {
    const previews = editSession?.previews ?? [];
    if (previews.length === 0) return null;
    if (selectedPreviewId) {
      const match = previews.find((p) => p.previewId === selectedPreviewId);
      if (match) return match;
    }
    if (editSession?.acceptedPreviewId) {
      const accepted = previews.find((p) => p.previewId === editSession.acceptedPreviewId);
      if (accepted) return accepted;
    }
    return previews[previews.length - 1];
  }, [editSession, selectedPreviewId]);

  const markedFrameCount = useMemo(
    () => registeredFrames.filter((f) => f.userMarked).length,
    [registeredFrames]
  );

  const hasEditedScene = Boolean(
    sceneData?.versions?.edited?.splatUrl || Object.keys(objectOverrides).length > 0
  );

  const isCurrentPreviewAccepted = Boolean(
    editSession &&
      displayedPreview &&
      editSession.acceptanceValid &&
      editSession.acceptedPreviewId === displayedPreview.previewId &&
      displayedPreview.maskRevision === editSession.currentMaskRevision &&
      displayedPreview.referenceFrameId === activeFrameId &&
      displayedPreview.prompt.trim() === prompt.trim() &&
      !reviewDirty
  );

  // Sync natural dimensions whenever activeFrame changes
  useEffect(() => {
    if (!activeFrame) return;
    setFrameNaturalSize({
      w: activeFrame.width || 960,
      h: activeFrame.height || 540,
    });
    if (activeFrame.confidence > 0) {
      setMaskConfidence(activeFrame.confidence);
    } else {
      setMaskConfidence(0);
    }
  }, [activeFrame]);

  // Measure rendered object-contain box inside 2D Reference Frame stage
  useEffect(() => {
    const stage = frameStageRef.current;
    if (!stage || selectionSurface !== 'frame') return;

    const updateBox = () => {
      setFrameRenderBox(
        computeObjectContainBox(
          stage.clientWidth,
          stage.clientHeight,
          frameNaturalSize.w,
          frameNaturalSize.h
        )
      );
    };
    updateBox();

    if (typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(updateBox);
    obs.observe(stage);
    return () => obs.disconnect();
  }, [selectionSurface, frameNaturalSize]);

  // Poll an active worker task (tracking / batch_edit / rebuild) until terminal state
  const pollTaskUntilDone = useCallback(
    async (
      taskId: string,
      onUpdate: (t: ReconstructionTask) => void
    ): Promise<ReconstructionTask | null> => {
      while (mountedRef.current) {
        const latest = await api.getTask(taskId);
        if (!mountedRef.current || !latest) return latest;
        onUpdate(latest);
        if (
          latest.status === 'completed' ||
          latest.status === 'failed' ||
          latest.status === 'error' ||
          latest.status === 'cancelled'
        ) {
          return latest;
        }
        await sleep(1100);
      }
      return null;
    },
    []
  );

  const refreshSceneAndEdit = useCallback(
    async (proj: Project, editIdToLoad?: string | null) => {
      const scene = await api.getScene(proj);
      if (!mountedRef.current) return null;
      setSceneData(scene);
      setActiveSceneVersion(scene.versions?.edited ? scene.activeVersion || 'edited' : 'original');

      let edit: EditSessionDTO | null = null;
      if (editIdToLoad) {
        try {
          edit = await api.getEditSession(proj.id, editIdToLoad, scene.runId);
        } catch {
          edit = await api.restoreLatestEditSession(proj.id, scene.manifestUrl, scene.runId);
        }
      } else {
        edit = await api.restoreLatestEditSession(proj.id, scene.manifestUrl, scene.runId);
      }
      if (!mountedRef.current) return { scene, edit: null };

      const hydrated = hydrateFramesFromEdit(scene.sampledFrames, edit?.reviewedFrames);
      setSampledFrames(hydrated.nextFrames);
      if (Object.keys(hydrated.pointsByFrame).length > 0) {
        setPerFramePoints(hydrated.pointsByFrame);
      }
      if (edit) {
        setEditSession(edit);
        if (edit.prompt) setPrompt(edit.prompt);
        if (edit.acceptedPreviewId) {
          setSelectedPreviewId(edit.acceptedPreviewId);
        } else if (edit.previews.length > 0) {
          setSelectedPreviewId(edit.previews[edit.previews.length - 1].previewId);
        }
      }
      return { scene, edit };
    },
    []
  );

  // Load ONLY existing project/scene/edit state on mount (NEVER auto-generate preview)
  useEffect(() => {
    let active = true;
    clearJobTimers();

    const loadStudioState = async () => {
      setStudioLoading(true);
      setStudioError(null);
      setSceneData(null);
      setEditSession(null);
      setPerFramePoints({});
      setSelectedPreviewId(null);
      setPrompt('');
      setPipelineError(null);
      setRebuildStage('idle');
      setTrackingTask(null);
      setBatchTask(null);
      setRebuildTask(null);

      try {
        let targetProject: Project | undefined = projectId
          ? projectsRef.current.find((p) => p.id === projectId)
          : projectsRef.current.find((p) => p.status === 'ready') || projectsRef.current[0];

        if (!targetProject && projectId && !demoMode) {
          targetProject = await api.getProject(projectId);
        }

        if (!active) return;

        if (!targetProject) {
          setResolvedProject(null);
          setStudioError(
            projectId
              ? `Project "${projectId}" was not found or belongs to another session.`
              : 'No reconstructed 3D room project is ready yet.'
          );
          setStudioLoading(false);
          return;
        }

        setResolvedProject(targetProject);

        const scene = await api.getScene(targetProject);
        if (!active) return;
        setSceneData(scene);
        setActiveSceneVersion(
          scene.versions?.edited ? scene.activeVersion || 'edited' : 'original'
        );

        const restored = await api.restoreLatestEditSession(
          targetProject.id,
          scene.manifestUrl,
          scene.runId
        );
        if (!active) return;

        const hydrated = hydrateFramesFromEdit(scene.sampledFrames, restored?.reviewedFrames);
        setSampledFrames(hydrated.nextFrames);
        setPerFramePoints(hydrated.pointsByFrame);

        const firstRegFrame =
          hydrated.nextFrames.find((f) => f.registered !== false) || hydrated.nextFrames[0];
        const initialFrameId =
          restored?.referenceFrameId &&
          hydrated.nextFrames.some(
            (f) => f.id === restored.referenceFrameId && f.registered !== false
          )
            ? restored.referenceFrameId
            : firstRegFrame?.id || '';
        setActiveFrameId(initialFrameId);

        const initialFrame = hydrated.nextFrames.find((f) => f.id === initialFrameId);
        if (initialFrame) {
          setMaskConfidence(initialFrame.confidence || 0);
          const initialPose =
            initialFrame.cameraPose ||
            scene.cameraPoses.find((p) => p.frameId === initialFrame.id);
          if (initialPose) {
            window.setTimeout(() => {
              if (mountedRef.current) viewportRef.current?.loadCameraPose(initialPose);
            }, 120);
          }
        }

        if (restored) {
          setEditSession(restored);
          setPrompt(restored.prompt || '');
          if (restored.acceptedPreviewId) {
            setSelectedPreviewId(restored.acceptedPreviewId);
          } else if (restored.previews.length > 0) {
            setSelectedPreviewId(restored.previews[restored.previews.length - 1].previewId);
          }

          // Resume polling any active tracking / batch_edit / rebuild task after refresh
          if (restored.trackingTaskId && !demoMode) {
            void api.getTask(restored.trackingTaskId).then((t) => {
              if (!t || !mountedRef.current) return;
              setTrackingTask(t);
              if (t.status === 'queued' || t.status === 'running') {
                setIsTracking(true);
                setTrackingPct(t.progress);
                void pollTaskUntilDone(t.id, (u) => {
                  setTrackingTask(u);
                  setTrackingPct(u.progress);
                }).then((doneTask) => {
                  if (!mountedRef.current) return;
                  setIsTracking(false);
                  if (doneTask?.status === 'completed') {
                    void refreshSceneAndEdit(targetProject!, restored.editId);
                  } else if (doneTask?.error) {
                    setPipelineError(doneTask.error);
                  }
                });
              }
            });
          }

          if (restored.rebuildTaskId && !demoMode) {
            void api.getTask(restored.rebuildTaskId).then((t) => {
              if (!t || !mountedRef.current) return;
              setRebuildTask(t);
              if (t.status === 'queued' || t.status === 'running') {
                setRebuildStage('rebuilding');
                setRebuildPct(t.progress);
                void pollTaskUntilDone(t.id, (u) => {
                  setRebuildTask(u);
                  setRebuildPct(u.progress);
                }).then((doneTask) => {
                  if (!mountedRef.current) return;
                  if (doneTask?.status === 'completed') {
                    setRebuildStage('done');
                    void refreshSceneAndEdit(targetProject!, restored.editId);
                    void refreshProjects();
                  } else if (doneTask) {
                    setRebuildStage('error');
                    setPipelineError(doneTask.error || 'Rebuild failed.');
                  }
                });
              } else if (t.status === 'completed') {
                setRebuildStage('done');
                setRebuildPct(100);
              }
            });
          } else if (restored.batchEditTaskId && !demoMode) {
            void api.getTask(restored.batchEditTaskId).then((t) => {
              if (!t || !mountedRef.current) return;
              setBatchTask(t);
              if (t.status === 'queued' || t.status === 'running') {
                const count = Math.max(
                  1,
                  hydrated.nextFrames.filter((f) => f.registered !== false && f.userMarked).length
                );
                setRebuildStage('diffusion');
                setRebuildPct(Math.round(t.progress * 0.55));
                setDiffusionFrameIndex(
                  Math.max(1, Math.min(count, Math.round((t.progress / 100) * count)))
                );
                void pollTaskUntilDone(t.id, (u) => {
                  setBatchTask(u);
                  setRebuildPct(Math.round(u.progress * 0.55));
                  setDiffusionFrameIndex(
                    Math.max(1, Math.min(count, Math.round((u.progress / 100) * count)))
                  );
                }).then((doneTask) => {
                  if (!mountedRef.current) return;
                  if (doneTask?.status === 'failed' || doneTask?.status === 'error') {
                    setRebuildStage('error');
                    setPipelineError(doneTask.error || 'Batch diffusion failed.');
                  }
                });
              }
            });
          }
        }
      } catch (err) {
        if (!active) return;
        const msg =
          err instanceof Error && err.message
            ? err.message
            : 'Unable to load reconstructed 3D scene from backend.';
        setStudioError(msg);
      } finally {
        if (active) setStudioLoading(false);
      }
    };

    void loadStudioState();

    return () => {
      active = false;
    };
  }, [projectId, demoMode, clearJobTimers, pollTaskUntilDone, refreshSceneAndEdit, refreshProjects]);

  // Drag handler for Before/After split divider (demo fallback mode)
  useEffect(() => {
    if (!draggingSplit) return;
    const handleMove = (e: PointerEvent) => {
      const box = splitContainerRef.current?.getBoundingClientRect();
      if (!box || box.width <= 0) return;
      const pct = Math.max(8, Math.min(92, ((e.clientX - box.left) / box.width) * 100));
      setSplitPct(pct);
    };
    const handleUp = () => setDraggingSplit(false);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [draggingSplit]);

  const ensureEditSession = useCallback(async (): Promise<EditSessionDTO | null> => {
    if (!resolvedProject) return null;
    if (editSessionRef.current) return editSessionRef.current;
    const created = await api.createEditSession(
      resolvedProject.id,
      {
        reference_frame_id: activeFrameId || null,
        prompt: prompt.trim(),
      },
      sceneData?.runId
    );
    if (mountedRef.current) {
      setEditSession(created);
    }
    return created;
  }, [resolvedProject, activeFrameId, prompt, sceneData?.runId]);

  const invalidateAcceptanceLocally = useCallback(() => {
    setEditSession((prev) => {
      if (!prev) return prev;
      const wasAccepted = Boolean(prev.acceptedPreviewId || prev.acceptanceValid);
      if (!wasAccepted) return prev;
      return {
        ...prev,
        acceptedPreviewId: null,
        acceptanceValid: false,
        acceptanceInvalidated: true,
      };
    });
  }, []);

  // Debounced prompt sync to backend when editSession exists (invalidates backend acceptance on prompt change)
  useEffect(() => {
    if (!resolvedProject || !editSessionRef.current) return;
    const currentSession = editSessionRef.current;
    if (prompt.trim() === (currentSession.prompt || '').trim()) return;

    const timer = window.setTimeout(() => {
      if (!mountedRef.current || !editSessionRef.current) return;
      void api
        .updateEditSession(
          resolvedProject.id,
          editSessionRef.current.editId,
          { prompt },
          sceneData?.runId
        )
        .then((updated) => {
          if (mountedRef.current) setEditSession(updated);
        })
        .catch(() => {
          // Ignore transient sync error while typing
        });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [prompt, resolvedProject, sceneData?.runId]);

  const handlePromptChange = (nextPrompt: string) => {
    setPrompt(nextPrompt);
    if (
      editSession &&
      editSession.acceptedPreviewId &&
      nextPrompt.trim() !== (editSession.prompt || '').trim()
    ) {
      invalidateAcceptanceLocally();
    }
  };

  // Select a registered frame & snap 3D camera to its real COLMAP training pose
  const handleSelectReferenceFrame = useCallback(
    async (frameId: string) => {
      const target = sampledFramesRef.current.find((f) => f.id === frameId);
      if (!target) return;
      if (target.registered === false) {
        showToast(
          `Frame #${target.index} is unregistered (${target.droppedReason || 'dropped'}) and cannot be used as reference.`,
          'warning'
        );
        return;
      }

      setActiveFrameId(frameId);
      const pose =
        target.cameraPose || sceneData?.cameraPoses.find((p) => p.frameId === frameId) || null;
      if (pose) {
        viewportRef.current?.loadCameraPose(pose);
      }

      const cur = editSessionRef.current;
      if (resolvedProject && cur && cur.referenceFrameId !== frameId) {
        invalidateAcceptanceLocally();
        try {
          const updated = await api.updateEditSession(
            resolvedProject.id,
            cur.editId,
            { reference_frame_id: frameId },
            sceneData?.runId
          );
          if (mountedRef.current) setEditSession(updated);
        } catch {
          // Keep local invalidation
        }
      }
    },
    [resolvedProject, sceneData?.cameraPoses, sceneData?.runId, showToast, invalidateAcceptanceLocally]
  );

  // Segment or re-segment a frame when points are added or removed
  const runSegmentationForFrame = useCallback(
    async (frameId: string, nextPoints: MaskPoint[], isReferenceUpdate = true) => {
      if (!resolvedProject) return;
      const frame = sampledFramesRef.current.find((f) => f.id === frameId);
      if (!frame || frame.registered === false) return;

      const w = frame.width || frameNaturalSize.w || 960;
      const h = frame.height || frameNaturalSize.h || 540;

      setPerFramePoints((prev) => ({ ...prev, [frameId]: nextPoints }));
      invalidateAcceptanceLocally();

      if (nextPoints.length === 0) {
        setSampledFrames((prev) =>
          prev.map((f) =>
            f.id === frameId
              ? {
                  ...f,
                  maskUrl: null,
                  confidence: 0,
                  boundingBoxPx: null,
                  maskBox: { x: 0, y: 0, w: 0, h: 0 },
                  userMarked: false,
                  includeInEdit: false,
                  hasObject: false,
                }
              : f
          )
        );
        if (frameId === activeFrameId) setMaskConfidence(0);

        if (editSessionRef.current && editSessionRef.current.currentMaskRevision > 0) {
          try {
            const updated = await api.saveReviewedFrames(
              resolvedProject.id,
              editSessionRef.current.editId,
              [
                {
                  frame_id: frameId,
                  include_in_edit: false,
                  user_marked: false,
                  clicks: [],
                  rerun_segmentation: false,
                },
              ],
              sceneData?.runId
            );
            if (mountedRef.current) setEditSession(updated);
          } catch {
            // Ignore cleanup failure
          }
        }
        return;
      }

      setSegmenting(true);
      setResegmentingFrameId(frameId);
      try {
        const session = await ensureEditSession();
        if (!session) return;
        const pixelClicks = maskPointsToPixelClicks(nextPoints, w, h);

        if (isReferenceUpdate) {
          const seg = await api.segmentWithPixelClicks(
            resolvedProject.id,
            session.editId,
            frameId,
            pixelClicks
          );
          if (!mountedRef.current) return;

          setMaskConfidence(seg.maskConfidence);
          setSampledFrames((prev) =>
            prev.map((f) => {
              if (f.id !== frameId) return f;
              const bb = seg.boundingBoxPx;
              return {
                ...f,
                maskUrl: seg.maskUrl || f.maskUrl,
                confidence: seg.maskConfidence,
                maskRevision: seg.maskRevision,
                boundingBoxPx: bb ?? f.boundingBoxPx,
                maskBox: bb
                  ? {
                      x: (bb.xMin / w) * 100,
                      y: (bb.yMin / h) * 100,
                      w: (bb.width / w) * 100,
                      h: (bb.height / h) * 100,
                    }
                  : f.maskBox,
                hasObject: true,
                includeInEdit: true,
                userMarked: true,
              };
            })
          );
          setEditSession((prev) =>
            prev
              ? {
                  ...prev,
                  referenceFrameId: frameId,
                  currentMaskRevision: seg.maskRevision,
                  acceptedPreviewId: null,
                  acceptanceValid: false,
                  acceptanceInvalidated:
                    Boolean(seg.acceptanceInvalidated) || Boolean(prev.acceptedPreviewId),
                }
              : prev
          );
        } else {
          // Hint placement on a non-reference frame inside FrameMaskGridModal
          const updatedSession = await api.saveReviewedFrames(
            resolvedProject.id,
            session.editId,
            [
              {
                frame_id: frameId,
                include_in_edit: true,
                user_marked: true,
                clicks: pixelClicks,
                rerun_segmentation: true,
              },
            ],
            sceneData?.runId
          );
          if (!mountedRef.current) return;
          setEditSession(updatedSession);
          const hydrated = hydrateFramesFromEdit(
            sampledFramesRef.current,
            updatedSession.reviewedFrames
          );
          setSampledFrames(hydrated.nextFrames);
        }
      } catch (err) {
        const msg =
          err instanceof Error && err.message ? err.message : 'Segmentation failed.';
        showToast(msg, 'error');
      } finally {
        if (mountedRef.current) {
          setSegmenting(false);
          setResegmentingFrameId(null);
        }
      }
    },
    [
      resolvedProject,
      frameNaturalSize.w,
      frameNaturalSize.h,
      activeFrameId,
      sceneData?.runId,
      ensureEditSession,
      invalidateAcceptanceLocally,
      showToast,
    ]
  );

  // 3D viewport click hook (preserves W7/W8 3D pick metadata; directs Live users to 2D frame for exact pixel clicks)
  const handleViewportClick = useCallback(
    (xPct: number, yPct: number, hitObjectId: string | null) => {
      setLastClickCoord({ label: `3D (${Math.round(xPct)}%, ${Math.round(yPct)}%)` });
      if (hitObjectId) {
        setSelectedObjectId(hitObjectId);
        const found = sceneData?.objects.find((o) => o.id === hitObjectId);
        if (found) {
          handlePromptChange(found.defaultPrompt);
        }
      }
      if (!demoMode && drawerOpen) {
        showToast(
          'Switch to "2D Reference Frame" to place exact pixel clicks on a registered camera image.',
          'info'
        );
      }
    },
    [demoMode, drawerOpen, sceneData?.objects, showToast]
  );

  // Exact Original-Image Pixel Click handler for 2D Reference Frame stage (0 .. width-1 / height-1)
  const handleReferenceFrameClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canEdit) {
      showToast('Read-only session: edit:write permission is required to segment objects.', 'warning');
      return;
    }
    if (!activeFrame || segmenting) return;
    if (activeFrame.registered === false) {
      showToast('Select a registered camera frame before placing mask clicks.', 'warning');
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const natW = frameNaturalSize.w || activeFrame.width || 960;
    const natH = frameNaturalSize.h || activeFrame.height || 540;
    const mapped = mapClientClickToImagePixel(e.clientX, e.clientY, rect, natW, natH);
    if (!mapped) {
      showToast('Click directly inside the frame image area.', 'info');
      return;
    }

    setLastClickCoord({ label: `${mapped.xPx}px, ${mapped.yPx}px` });

    const newPoint: MaskPoint = {
      id: `pt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      x: (mapped.xPx / Math.max(1, natW - 1)) * 100,
      y: (mapped.yPx / Math.max(1, natH - 1)) * 100,
      xPx: mapped.xPx,
      yPx: mapped.yPx,
      type: pointMode,
      frameId: activeFrame.id,
    };
    const nextPoints = [...activeFramePoints, newPoint];
    void runSegmentationForFrame(activeFrame.id, nextPoints, true);
  };

  const handleRemovePoint = (frameId: string, pointId: string) => {
    if (!canEdit) return;
    const existing = perFramePoints[frameId] ?? [];
    const next = existing.filter((p) => p.id !== pointId);
    void runSegmentationForFrame(frameId, next, true);
  };

  const handleUndoPoint = () => {
    if (!canEdit || !activeFrameId || activeFramePoints.length === 0) return;
    const next = activeFramePoints.slice(0, -1);
    void runSegmentationForFrame(activeFrameId, next, true);
  };

  // Tracking across registered frames
  const handleRunTracking = async () => {
    if (!canEdit) {
      showToast('Read-only session: edit:write permission is required.', 'warning');
      return;
    }
    if (!resolvedProject || isTracking) return;
    if (!editSession || editSession.currentMaskRevision < 1) {
      showToast(
        'Place at least 1 pixel click on the 2D Reference Frame to segment the object before tracking.',
        'warning'
      );
      setSelectionSurface('frame');
      return;
    }

    setPipelineError(null);
    setIsTracking(true);
    setTrackingPct(5);

    if (demoMode) {
      const steps = [32, 68, 100];
      steps.forEach((pct, idx) => {
        const id = window.setTimeout(async () => {
          if (!mountedRef.current) return;
          setTrackingPct(pct);
          if (pct === 100) {
            try {
              const tracked = await api.trackObjectAcrossFrames(
                resolvedProject.id,
                sampledFramesRef.current
              );
              if (!mountedRef.current) return;
              setSampledFrames(tracked);
              setIsTracking(false);
              showToast(
                `Tracked across ${tracked.filter((f) => f.userMarked).length} frames — open Mark Frames to verify.`,
                'success'
              );
            } catch {
              if (mountedRef.current) {
                setIsTracking(false);
                showToast('Tracking failed — use Mark Frames fallback.', 'warning');
              }
            }
          }
        }, (idx + 1) * 280);
        jobTimersRef.current.push(id);
      });
      return;
    }

    try {
      const regIds = registeredFrames.map((f) => f.id);
      const task = await api.startEditTracking(
        resolvedProject.id,
        editSession.editId,
        activeFrameId,
        editSession.currentMaskRevision,
        regIds
      );
      if (!mountedRef.current) return;
      setTrackingTask(task);
      setTrackingPct(task.progress);

      const finalTask = await pollTaskUntilDone(task.id, (u) => {
        setTrackingTask(u);
        setTrackingPct(u.progress);
      });
      if (!mountedRef.current || !finalTask) return;

      setIsTracking(false);
      if (finalTask.status === 'completed') {
        await refreshSceneAndEdit(resolvedProject, editSession.editId);
        showToast(
          'Tracking complete — review tracked masks in "Mark Frames" before previewing.',
          'success'
        );
      } else {
        const errText = finalTask.error || `Tracking ended with status: ${finalTask.status}`;
        setPipelineError(errText);
        showToast('Tracking did not complete — use "Mark Frames" fallback.', 'warning');
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setIsTracking(false);
      const msg = err instanceof Error ? err.message : 'Failed to launch tracking task.';
      setPipelineError(msg);
      showToast(msg, 'error');
    }
  };

  // Persist reviewed frame decisions from FrameMaskGridModal
  const handleSaveFrameReview = async () => {
    if (!canEdit || !resolvedProject) return;
    if (demoMode) {
      setReviewDirty(false);
      invalidateAcceptanceLocally();
      setFrameGridOpen(false);
      showToast(`Saved ${markedFrameCount} marked frames (Demo).`, 'success');
      return;
    }

    setSavingReview(true);
    try {
      const session = await ensureEditSession();
      if (!session) return;
      const decisions: ReviewedFrameDecision[] = registeredFrames.map((f) => {
        const w = f.width || 960;
        const h = f.height || 540;
        const pts = perFramePoints[f.id];
        return {
          frame_id: f.id,
          include_in_edit: Boolean(f.userMarked),
          user_marked: Boolean(f.userMarked),
          clicks: pts && pts.length > 0 ? maskPointsToPixelClicks(pts, w, h) : null,
          rerun_segmentation: false,
        };
      });
      if (decisions.length === 0) {
        showToast('No registered frames available to save.', 'warning');
        return;
      }
      const updated = await api.saveReviewedFrames(
        resolvedProject.id,
        session.editId,
        decisions,
        sceneData?.runId
      );
      if (!mountedRef.current) return;
      setEditSession(updated);
      const hydrated = hydrateFramesFromEdit(
        sampledFramesRef.current,
        updated.reviewedFrames
      );
      setSampledFrames(hydrated.nextFrames);
      setReviewDirty(false);
      setFrameGridOpen(false);
      showToast(
        `Saved mask review (rev #${updated.currentMaskRevision}, ${markedFrameCount} frames).`,
        'success'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save frame review.';
      showToast(msg, 'error');
    } finally {
      if (mountedRef.current) setSavingReview(false);
    }
  };

  // Explicit Generate / Regenerate Preview Seed (NEVER auto-accepts)
  const handleGeneratePreview = async () => {
    if (!canEdit || !resolvedProject || generatingPreview) return;
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      showToast('Enter an edit prompt before generating a reference preview.', 'warning');
      return;
    }
    if (!activeFrame || activeFrame.registered === false) {
      showToast('Select a registered reference frame first.', 'warning');
      return;
    }
    if (!editSession || editSession.currentMaskRevision < 1) {
      showToast(
        'Segment the target object on the 2D Reference Frame before generating a preview.',
        'warning'
      );
      setSelectionSurface('frame');
      return;
    }

    setGeneratingPreview(true);
    setPipelineError(null);
    try {
      if (demoMode) {
        const seed = Math.floor(10000 + Math.random() * 89999);
        const style = deriveDemoMaterial(trimmedPrompt);
        const variant: PreviewVariantDTO = {
          previewId: `prev_demo_s${seed}`,
          seed,
          prompt: trimmedPrompt,
          referenceFrameId: activeFrame.id,
          maskRevision: editSession.currentMaskRevision,
          previewImageUrl: style.previewImageUrl,
          createdAt: new Date().toISOString(),
          precision: 'bf16',
        };
        setEditSession((prev) =>
          prev
            ? {
                ...prev,
                prompt: trimmedPrompt,
                referenceFrameId: activeFrame.id,
                acceptedPreviewId: null,
                acceptanceValid: false,
                previews: [...prev.previews, variant],
              }
            : prev
        );
        setSelectedPreviewId(variant.previewId);
        showToast(
          `Preview Seed #${seed} ready — review and click "Accept Preview" to unlock batch edit.`,
          'info'
        );
        return;
      }

      const variant = await api.generatePreviewVariant(
        resolvedProject.id,
        editSession.editId,
        activeFrame.id,
        trimmedPrompt,
        undefined,
        sceneData?.runId
      );
      if (!mountedRef.current) return;

      const refreshed = await api.getEditSession(
        resolvedProject.id,
        editSession.editId,
        sceneData?.runId
      );
      if (!mountedRef.current) return;

      setEditSession(refreshed);
      setSelectedPreviewId(variant.previewId);
      showToast(
        `Preview ${variant.previewId} (Seed #${variant.seed}) ready — click "Accept Preview" before batch editing.`,
        'info'
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to generate reference diffusion preview.';
      setPipelineError(msg);
      showToast(msg, 'error');
    } finally {
      if (mountedRef.current) setGeneratingPreview(false);
    }
  };

  // Explicit Preview Approval Gate
  const handleAcceptPreview = async () => {
    if (!canEdit || !resolvedProject || !editSession || !displayedPreview || acceptingPreview) return;
    if (reviewDirty) {
      showToast('Save your modified frame selections in "Mark Frames" first.', 'warning');
      setFrameGridOpen(true);
      return;
    }

    setAcceptingPreview(true);
    setPipelineError(null);
    try {
      if (demoMode) {
        setEditSession((prev) =>
          prev
            ? {
                ...prev,
                acceptedPreviewId: displayedPreview.previewId,
                acceptanceValid: true,
                acceptanceInvalidated: false,
              }
            : prev
        );
        showToast(`Accepted preview ${displayedPreview.previewId}. Ready for batch edit!`, 'success');
        return;
      }

      const updated = await api.acceptPreview(
        resolvedProject.id,
        editSession.editId,
        displayedPreview.previewId,
        sceneData?.runId
      );
      if (!mountedRef.current) return;
      setEditSession(updated);
      showToast(
        `Accepted preview ${displayedPreview.previewId} — batch diffusion unlocked.`,
        'success'
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Could not accept preview — generate a fresh preview for current mask/prompt.';
      setPipelineError(msg);
      showToast(msg, 'error');
    } finally {
      if (mountedRef.current) setAcceptingPreview(false);
    }
  };

  // Batch Diffusion + 3DGS Rebuild (gated strictly on acceptedPreviewId)
  const handleRunBatchAndRebuild = async () => {
    if (!canEdit || !resolvedProject || !editSession) return;
    if (!isCurrentPreviewAccepted || !editSession.acceptedPreviewId) {
      showToast(
        'Accept the current reference preview before starting batch diffusion and 3D rebuild.',
        'warning'
      );
      return;
    }
    if (markedFrameCount === 0) {
      showToast('Mark at least 1 frame in "Mark Frames" before batch editing.', 'warning');
      setFrameGridOpen(true);
      return;
    }

    const acceptedId = editSession.acceptedPreviewId;
    const totalFrames = markedFrameCount;
    setPipelineError(null);

    if (demoMode) {
      clearJobTimers();
      const targetObj = selectedObjectId;
      const demoMat = deriveDemoMaterial(prompt);
      setRebuildStage('diffusion');
      setRebuildPct(10);
      setDiffusionFrameIndex(1);

      for (let i = 1; i <= totalFrames; i++) {
        const tId = window.setTimeout(() => {
          if (!mountedRef.current) return;
          setDiffusionFrameIndex(i);
          setRebuildPct(Math.round((i / totalFrames) * 55));
        }, i * 160);
        jobTimersRef.current.push(tId);
      }

      const diffDoneMs = totalFrames * 160 + 200;
      [68, 84, 100].forEach((pct, idx) => {
        const tId = window.setTimeout(() => {
          if (!mountedRef.current) return;
          setRebuildStage(pct === 100 ? 'done' : 'rebuilding');
          setRebuildPct(pct);
          if (pct === 100) {
            setObjectOverrides((prev) => ({
              ...prev,
              [targetObj]: { colorHex: demoMat.colorHex, label: demoMat.materialLabel },
            }));
            markProjectRestyled(resolvedProject.id, demoMat.materialLabel);
            setActiveSceneVersion('edited');
            setBeforeAfterActive(true);
            showToast(`Demo 3D room restyled with "${demoMat.materialLabel}".`, 'success');
          }
        }, diffDoneMs + (idx + 1) * 240);
        jobTimersRef.current.push(tId);
      });
      return;
    }

    try {
      setRebuildStage('diffusion');
      setRebuildPct(0);
      setDiffusionFrameIndex(0);

      const startedBatch = await api.startBatchEdit(
        resolvedProject.id,
        editSession.editId,
        acceptedId
      );
      if (!mountedRef.current) return;
      setBatchTask(startedBatch);

      const finishedBatch = await pollTaskUntilDone(startedBatch.id, (u) => {
        setBatchTask(u);
        setRebuildPct(Math.round(u.progress * 0.55));
        setDiffusionFrameIndex(
          Math.max(1, Math.min(totalFrames, Math.round((u.progress / 100) * totalFrames)))
        );
      });
      if (!mountedRef.current || !finishedBatch) return;

      if (finishedBatch.status !== 'completed') {
        setRebuildStage('error');
        const errMsg = finishedBatch.error || `Batch edit stopped (${finishedBatch.status}).`;
        setPipelineError(errMsg);
        showToast(errMsg, 'error');
        return;
      }

      setDiffusionFrameIndex(totalFrames);
      setRebuildStage('rebuilding');
      setRebuildPct(58);

      const startedRebuild = await api.startRebuild(
        resolvedProject.id,
        editSession.editId,
        acceptedId,
        rebuildMode
      );
      if (!mountedRef.current) return;
      setRebuildTask(startedRebuild);

      const finishedRebuild = await pollTaskUntilDone(startedRebuild.id, (u) => {
        setRebuildTask(u);
        setRebuildPct(55 + Math.round(u.progress * 0.45));
      });
      if (!mountedRef.current || !finishedRebuild) return;

      if (finishedRebuild.status !== 'completed') {
        setRebuildStage('error');
        const errMsg =
          finishedRebuild.error ||
          `Rebuild failed (${finishedRebuild.status}) — original 3D scene preserved.`;
        setPipelineError(errMsg);
        showToast(errMsg, 'error');
        return;
      }

      setRebuildStage('done');
      setRebuildPct(100);
      await refreshSceneAndEdit(resolvedProject, editSession.editId);
      await refreshProjects();
      if (mountedRef.current) {
        setActiveSceneVersion('edited');
        showToast(
          'Edited 3D scene published! Use Before / After toggle to compare from the exact same camera.',
          'success'
        );
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setRebuildStage('error');
      const msg = err instanceof Error ? err.message : 'Batch edit / rebuild request failed.';
      setPipelineError(msg);
      showToast(msg, 'error');
    }
  };

  const handleSliderKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSplitPct((p) => Math.max(8, p - 4));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSplitPct((p) => Math.min(92, p + 4));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setSplitPct(8);
    } else if (e.key === 'End') {
      e.preventDefault();
      setSplitPct(92);
    }
  };

  const speedLabel = flySpeed <= 1.0 ? 'Gentle' : flySpeed <= 2.0 ? 'Normal' : 'Brisk';
  const showOriginal3D = activeSceneVersion === 'original';
  const isPipelineRunning = rebuildStage === 'diffusion' || rebuildStage === 'rebuilding';

  if (studioLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-surface-container-low text-on-surface">
        <AppHeader />
        <main className="flex-1 flex items-center justify-center pt-20 p-6">
          <div className="p-8 rounded-3xl bg-white border border-border-sand shadow-card text-center space-y-3 max-w-md">
            <span className="material-symbols-outlined text-primary text-[36px] animate-spin">
              progress_activity
            </span>
            <h1 className="font-headline text-2xl font-medium">Loading 3D Studio Scene</h1>
            <p className="text-xs text-on-surface-muted">
              Fetching published splats, COLMAP camera poses, and saved edit checkpoints...
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (studioError || !resolvedProject || !sceneData) {
    return (
      <div className="min-h-screen flex flex-col bg-surface-container-low text-on-surface">
        <AppHeader />
        <main className="flex-1 flex items-center justify-center pt-20 p-6">
          <div className="p-8 rounded-3xl bg-white border border-border-sand shadow-card text-center space-y-4 max-w-lg">
            <div className="w-12 h-12 rounded-2xl bg-primary-container text-primary flex items-center justify-center mx-auto">
              <span className="material-symbols-outlined text-[28px]">view_in_ar</span>
            </div>
            <h1 className="font-headline text-2xl font-medium">3D Scene Not Ready</h1>
            <p className="text-sm text-on-surface-muted">
              {studioError || 'Could not load scene artifacts for this project.'}
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <Link
                to="/spaces"
                className="px-5 py-2.5 rounded-full bg-primary text-white text-xs font-semibold hover:bg-primary-hover"
              >
                Back to My Spaces
              </Link>
              <Link
                to="/scan"
                className="px-5 py-2.5 rounded-full bg-surface-container text-on-surface text-xs font-semibold hover:bg-surface-container-high"
              >
                Scan New Room
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-surface-container-low text-on-surface overflow-x-hidden">
      <AppHeader />

      <main className="w-full pt-20 flex-1 flex flex-col relative">
        <div
          ref={splitContainerRef}
          className="relative w-full h-[calc(100vh-80px-44px)] min-h-[640px] overflow-hidden bg-surface-container select-none"
        >
          {/* Persistent WebGL 3D Viewport (kept mounted so camera pose/path & version switching never reset camera) */}
          <div
            className={`absolute inset-0 transition-opacity duration-200 ${
              selectionSurface === '3d'
                ? 'opacity-100 pointer-events-auto z-0'
                : 'opacity-0 pointer-events-none -z-10'
            }`}
          >
            <SplatRoomViewport
              ref={viewportRef}
              cameraMode={cameraMode}
              flySpeed={flySpeed}
              renderMode={renderMode}
              sunAngleDeg={sunAngleDeg}
              selectedObjectId={selectedObjectId}
              objects={sceneData.objects}
              objectOverrides={objectOverrides}
              showOriginalScene={showOriginal3D}
              splatUrl={sceneData.versions?.original?.splatUrl || sceneData.splatUrl}
              pointCloudUrl={
                sceneData.versions?.original?.sparseCloudUrl ||
                sceneData.versions?.original?.plyUrl ||
                sceneData.pointCloudUrl
              }
              editedSplatUrl={sceneData.versions?.edited?.splatUrl}
              editedPointCloudUrl={
                sceneData.versions?.edited?.sparseCloudUrl ||
                sceneData.versions?.edited?.plyUrl ||
                undefined
              }
              activeSceneVersion={activeSceneVersion}
              viewerTransform={sceneData.viewerTransform}
              demoMode={demoMode}
              onArtifactStatusChange={setArtifactStatus}
              onScreenClick={handleViewportClick}
              onFpsUpdate={setFps}
              onPathPlayingChange={setPathPlaying}
            />
          </div>

          {/* 2D Undistorted Reference Frame Layer (exact object-contain pixel mapping + real mask PNG overlay) */}
          {selectionSurface === 'frame' && (
            <div
              ref={frameStageRef}
              className="absolute inset-0 z-10 bg-stone-950 flex items-center justify-center cursor-crosshair"
              onClick={handleReferenceFrameClick}
            >
              {activeFrame ? (
                <>
                  <ArtifactImage
                    src={activeFrame.imageUrl}
                    alt={`Reference frame ${activeFrame.index}`}
                    className="w-full h-full object-contain pointer-events-none select-none"
                    onNaturalDimensions={(w, h) => setFrameNaturalSize({ w, h })}
                  />

                  {frameRenderBox.width > 0 && frameRenderBox.height > 0 && (
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        left: `${frameRenderBox.offsetX}px`,
                        top: `${frameRenderBox.offsetY}px`,
                        width: `${frameRenderBox.width}px`,
                        height: `${frameRenderBox.height}px`,
                      }}
                    >
                      {activeFrame.maskUrl ? (
                        <MaskOverlayCanvas
                          maskUrl={activeFrame.maskUrl}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        activeFrame.maskBox.w > 0 &&
                        activeFrame.userMarked && (
                          <div
                            className="absolute border-2 border-dashed border-primary bg-primary/15 rounded-2xl"
                            style={{
                              left: `${activeFrame.maskBox.x}%`,
                              top: `${activeFrame.maskBox.y}%`,
                              width: `${activeFrame.maskBox.w}%`,
                              height: `${activeFrame.maskBox.h}%`,
                            }}
                          />
                        )
                      )}

                      {/* Per-frame SAM click pin markers (click a pin to remove & re-segment) */}
                      {activeFramePoints.map((pt) => {
                        const natW = frameNaturalSize.w || activeFrame.width || 960;
                        const natH = frameNaturalSize.h || activeFrame.height || 540;
                        const leftPct =
                          pt.xPx !== undefined
                            ? (pt.xPx / Math.max(1, natW - 1)) * 100
                            : pt.x;
                        const topPct =
                          pt.yPx !== undefined
                            ? (pt.yPx / Math.max(1, natH - 1)) * 100
                            : pt.y;
                        return (
                          <button
                            key={pt.id}
                            type="button"
                            title="Click pin to remove and re-segment"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemovePoint(activeFrame.id, pt.id);
                            }}
                            style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                            className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white shadow-lg border flex items-center justify-center hover:scale-110 transition-transform ${
                              pt.type === 'positive' ? 'border-primary/60' : 'border-error/70'
                            }`}
                          >
                            <span
                              className={`w-2.5 h-2.5 rounded-full ${
                                pt.type === 'positive' ? 'bg-primary' : 'bg-error'
                              }`}
                            />
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {segmenting && (
                    <div className="absolute top-20 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-black/75 text-white text-xs font-semibold shadow-lg">
                      Segmenting frame #{activeFrame.index}...
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs text-white/75">
                  No sampled training frames available in this scene manifest.
                </div>
              )}
            </div>
          )}

          {/* Optional Demo-only Before/After 2D Split Overlay (never covers real 3D edited version in Live Mode) */}
          {demoMode && beforeAfterActive && !sceneData.versions?.edited?.splatUrl && (
            <>
              <div
                className="absolute inset-0 z-20 pointer-events-none"
                style={{ clipPath: `inset(0 ${100 - splitPct}% 0 0)` }}
              >
                <SafeImage
                  src={sceneData.beforeImageUrl || STITCH_IMAGES.studioBeforeRender}
                  alt="Original room before object redesign"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
              </div>

              <div
                role="slider"
                aria-label="Before and After comparison slider"
                aria-valuemin={8}
                aria-valuemax={92}
                aria-valuenow={Math.round(splitPct)}
                tabIndex={0}
                onKeyDown={handleSliderKeyDown}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setDraggingSplit(true);
                }}
                style={{ left: `${splitPct}%` }}
                className="absolute top-0 bottom-0 w-0.5 bg-primary shadow-2xl cursor-ew-resize z-20 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/95 backdrop-blur-md shadow-lg border border-primary/30 flex items-center justify-center">
                  <span className="material-symbols-outlined text-primary text-[18px]">
                    compare_arrows
                  </span>
                </div>
                <span className="absolute top-24 -translate-x-full -ml-3 px-2.5 py-1 rounded-full bg-white/90 backdrop-blur-md text-[11px] font-semibold tracking-wider text-on-surface-muted uppercase shadow-sm border border-outline-variant/30 whitespace-nowrap">
                  Original Room
                </span>
                <span className="absolute top-24 ml-3 px-2.5 py-1 rounded-full bg-primary text-white text-[11px] font-semibold tracking-wider uppercase shadow-md whitespace-nowrap">
                  Restyled 3D
                </span>
              </div>
            </>
          )}

          {/* Top-Left Floating Controls: Navigation, Speed, Render Mode, Poses */}
          <div className="absolute top-5 left-5 z-30 flex flex-col gap-2.5 max-w-xl pointer-events-auto">
            <div className="p-1.5 rounded-2xl bg-white/90 backdrop-blur-md shadow-lg shadow-black/5 border border-white/70 flex flex-wrap items-center gap-2">
              <div className="flex items-center p-0.5 rounded-xl bg-surface-container/70 border border-outline-variant/20">
                <button
                  type="button"
                  onClick={() => setCameraMode('orbit')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                    cameraMode === 'orbit'
                      ? 'bg-white text-primary-deep shadow-sm'
                      : 'text-on-surface-muted hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[15px]">360</span>
                  <span>Orbit Mode</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCameraMode('fly')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                    cameraMode === 'fly'
                      ? 'bg-white text-primary-deep shadow-sm'
                      : 'text-on-surface-muted hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[15px]">directions_walk</span>
                  <span>Walkthrough (WASD)</span>
                </button>
              </div>

              <div className="h-4 w-px bg-outline-variant/50 hidden sm:block" />

              <div className="hidden sm:flex items-center gap-2 px-2 py-1">
                <span className="text-[11px] font-medium text-on-surface-muted">Pace:</span>
                <input
                  type="range"
                  min={0.5}
                  max={3.0}
                  step={0.5}
                  value={flySpeed}
                  onChange={(e) => setFlySpeed(parseFloat(e.target.value))}
                  aria-label="Walkthrough speed"
                  className="w-16 accent-primary cursor-pointer h-1.5 bg-surface-container-highest rounded-lg"
                />
                <span className="text-[11px] font-semibold text-primary-deep w-12">
                  {speedLabel}
                </span>
              </div>
            </div>

            {/* Render Mode + Camera Pose Loader Row */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setRenderMode((m) => (m === 'splat' ? 'pointcloud' : 'splat'))}
                className="px-3 py-1.5 rounded-full bg-white/85 backdrop-blur-md shadow-sm border border-white/70 text-[11px] font-semibold text-on-surface flex items-center gap-1.5 hover:bg-white transition-colors"
                title="Toggle between Gaussian Splat Studio and Sparse Point Cloud fallback (W_7)"
              >
                <span className="material-symbols-outlined text-[14px] text-primary">
                  {renderMode === 'splat' ? 'blur_on' : 'grain'}
                </span>
                <span>
                  {renderMode === 'splat' ? 'Gaussian Splats' : 'Sparse Point Cloud'}
                </span>
              </button>

              {sceneData.cameraPoses.slice(0, 5).map((pose) => (
                <button
                  key={pose.id}
                  type="button"
                  onClick={() => {
                    setSelectionSurface('3d');
                    viewportRef.current?.loadCameraPose(pose);
                  }}
                  className="px-2.5 py-1.5 rounded-full bg-white/80 hover:bg-white backdrop-blur-md shadow-sm border border-white/70 text-[11px] font-medium text-on-surface-muted hover:text-primary-deep transition-colors"
                >
                  {pose.label}
                </button>
              ))}

              <button
                type="button"
                onClick={() => {
                  if (pathPlaying) {
                    viewportRef.current?.stopCameraPath();
                  } else {
                    setSelectionSurface('3d');
                    viewportRef.current?.playCameraPath(sceneData.cameraPath);
                  }
                }}
                className={`px-2.5 py-1.5 rounded-full backdrop-blur-md shadow-sm border text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                  pathPlaying
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white/80 hover:bg-white text-on-surface border-white/70'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">
                  {pathPlaying ? 'stop_circle' : 'play_circle'}
                </span>
                <span>{pathPlaying ? 'Stop Path' : 'Camera Path'}</span>
              </button>

              <button
                type="button"
                onClick={() => viewportRef.current?.resetCamera()}
                title="Reset Camera Pose"
                className="px-2.5 py-1.5 rounded-full bg-white/80 hover:bg-white backdrop-blur-md shadow-sm border border-white/70 text-[11px] font-medium text-on-surface-muted hover:text-on-surface flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">restart_alt</span>
                <span>Reset</span>
              </button>
            </div>

            {/* Sun, Scene Version & Click Telemetry Pill */}
            <div className="flex flex-wrap items-center gap-2">
              {demoMode && (
                <div className="px-3 py-1 rounded-full bg-white/80 backdrop-blur-md shadow-sm border border-white/60 flex items-center gap-2 text-[11px] text-on-surface-muted font-medium">
                  <span className="material-symbols-outlined text-amber-700 text-[14px]">
                    wb_sunny
                  </span>
                  <span>Sun Angle:</span>
                  <input
                    type="range"
                    min={10}
                    max={85}
                    value={sunAngleDeg}
                    onChange={(e) => setSunAngleDeg(Number(e.target.value))}
                    aria-label="Room sunlight angle"
                    className="w-16 accent-secondary h-1 cursor-pointer"
                  />
                </div>
              )}

              {artifactStatus && !demoMode && (
                <div className="px-3 py-1 rounded-full bg-white/85 backdrop-blur-md shadow-sm border border-white/60 text-[11px] font-medium text-on-surface-muted">
                  Scene: <strong className="text-primary-deep">{activeSceneVersion}</strong>
                  {artifactStatus.gaussianCount
                    ? ` • ${artifactStatus.gaussianCount.toLocaleString()} splats`
                    : ''}
                </div>
              )}

              {lastClickCoord && (
                <div className="px-3 py-1 rounded-full bg-white/80 backdrop-blur-md shadow-sm border border-white/60 text-[11px] text-on-surface-muted font-mono">
                  Click: {lastClickCoord.label}
                </div>
              )}
            </div>
          </div>

          {/* Top-Right Actions: Camera-Preserving Before/After Scene Toggle & Stylist Drawer Toggle */}
          <div className="absolute top-5 right-5 z-30 flex items-center gap-2.5 flex-wrap justify-end">
            {canShare && (
              <button
                type="button"
                onClick={handleOpenShareModal}
                className="hidden sm:flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-white/85 backdrop-blur-md shadow-lg shadow-black/5 border border-white/60 text-xs font-medium text-on-surface hover:bg-white transition-all"
              >
                <span className="material-symbols-outlined text-[16px] text-primary">share</span>
                <span>Share</span>
              </button>
            )}

            {/* Camera-Preserving Original vs Edited 3D Scene Version Toggle */}
            {hasEditedScene && (
              <div
                className="p-1 rounded-2xl bg-white/90 backdrop-blur-md shadow-lg shadow-black/5 border border-white/70 flex items-center gap-1"
                role="group"
                aria-label="Before and After 3D scene version toggle"
              >
                <button
                  type="button"
                  onClick={() => {
                    setActiveSceneVersion('original');
                    setBeforeAfterActive(false);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    activeSceneVersion === 'original'
                      ? 'bg-primary-deep text-white shadow-sm'
                      : 'text-on-surface-muted hover:text-on-surface'
                  }`}
                >
                  Before (Original)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSceneVersion('edited');
                    setBeforeAfterActive(false);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    activeSceneVersion === 'edited'
                      ? 'bg-primary-deep text-white shadow-sm'
                      : 'text-on-surface-muted hover:text-on-surface'
                  }`}
                >
                  After (Edited)
                </button>
              </div>
            )}

            {demoMode && !sceneData.versions?.edited?.splatUrl && (
              <button
                type="button"
                onClick={() => setBeforeAfterActive((v) => !v)}
                className="flex items-center gap-2.5 px-4 py-2 rounded-2xl bg-white/90 backdrop-blur-md shadow-lg shadow-black/5 border border-white/60 text-on-surface hover:bg-white transition-all"
              >
                <span className="material-symbols-outlined text-[18px] text-primary">
                  auto_stories
                </span>
                <span className="text-xs font-semibold">Split Compare</span>
                <span
                  className={`w-8 h-4 rounded-full p-0.5 flex items-center transition-colors ${
                    beforeAfterActive ? 'bg-primary' : 'bg-surface-container-highest'
                  }`}
                >
                  <span
                    className={`w-3 h-3 rounded-full transition-transform ${
                      beforeAfterActive ? 'translate-x-4 bg-white' : 'bg-outline'
                    }`}
                  />
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setDrawerOpen((o) => !o)}
              className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-primary-deep hover:bg-primary-container-deep text-white shadow-lg shadow-primary/20 text-xs font-semibold transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">palette</span>
              <span>{drawerOpen ? 'Hide Stylist' : 'Redesign Furniture'}</span>
            </button>
          </div>

          {/* Reference Frame Strip (shown when 2D Reference Frame mode is active) */}
          {selectionSurface === 'frame' && sampledFrames.length > 0 && (
            <div className="absolute bottom-5 left-5 z-30 max-w-2xl bg-white/90 backdrop-blur-md rounded-2xl p-2.5 border border-border-sand shadow-lg flex items-center gap-2 overflow-x-auto atelier-scroll">
              {sampledFrames.map((f) => {
                const isReg = f.registered !== false;
                const pinCount = perFramePoints[f.id]?.length ?? 0;
                return (
                  <button
                    key={f.id}
                    type="button"
                    disabled={!isReg}
                    onClick={() => void handleSelectReferenceFrame(f.id)}
                    title={
                      isReg
                        ? `Snap to Frame #${f.index} (${f.width || 960}×${f.height || 540})`
                        : `Unregistered: ${f.droppedReason || 'dropped'}`
                    }
                    className={`relative w-20 h-14 rounded-xl overflow-hidden shrink-0 border-2 bg-stone-900 transition-all ${
                      !isReg
                        ? 'opacity-40 cursor-not-allowed border-transparent'
                        : f.id === activeFrameId
                          ? 'border-primary ring-2 ring-primary/30'
                          : 'border-transparent opacity-80 hover:opacity-100'
                    }`}
                  >
                    <ArtifactImage
                      src={f.imageUrl}
                      alt={`Frame ${f.index}`}
                      className="w-full h-full object-contain"
                    />
                    <span className="absolute bottom-0.5 right-1 text-[9px] font-semibold bg-black/70 text-white px-1 rounded">
                      {f.timestampLabel}
                    </span>
                    {pinCount > 0 && (
                      <span className="absolute top-0.5 left-1 text-[9px] font-bold bg-primary text-white px-1 rounded">
                        {pinCount}p
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Side Drawer: Week 2 Edit Object & Redesign Panel */}
          <aside
            aria-hidden={!drawerOpen}
            className={`absolute top-20 right-5 bottom-5 w-[382px] max-w-[calc(100vw-32px)] z-30 rounded-3xl bg-white/[0.94] backdrop-blur-md shadow-2xl shadow-stone-900/10 border border-white/80 flex flex-col overflow-hidden transition-all duration-300 ${
              drawerOpen
                ? 'translate-x-0 visible'
                : 'translate-x-[440px] invisible pointer-events-none'
            }`}
          >
            <div className="px-5 py-4 bg-gradient-to-b from-surface-container-low/80 to-surface-container-low/40 border-b border-outline-variant/30 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-primary-deep/10 flex items-center justify-center text-primary-deep">
                  <span className="material-symbols-outlined text-[18px]">chair</span>
                </div>
                <div>
                  <h2 className="font-headline text-lg font-semibold text-on-surface leading-tight">
                    Redesign An Object
                  </h2>
                  <p className="text-[11px] text-on-surface-muted font-medium">
                    {editSession
                      ? `Edit ${editSession.editId} • Mask rev #${editSession.currentMaskRevision}`
                      : 'Pixel Segmentation + Approved Diffusion'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                title="Close Panel"
                className="w-7 h-7 rounded-full bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface-muted transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3.5 atelier-scroll select-text">
              {!canEdit && (
                <div className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 font-medium">
                  Read-only role: <code>edit:write</code> permission is required to modify masks, previews, or 3D rebuilds.
                </div>
              )}
              {/* Step 1: Select Registered Frame & Pixel Mask Refinement */}
              <section className="p-3.5 rounded-2xl bg-white/85 border border-outline-variant/30 shadow-sm flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] tracking-wider uppercase font-semibold text-primary-deep">
                    Step 01 • Select &amp; Segment
                  </span>
                  <span className="text-[11px] font-medium text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    {maskConfidence > 0 ? `${Math.round(maskConfidence * 100)}% Mask` : 'No Mask'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-surface-container-low border border-border-sand">
                  <button
                    type="button"
                    onClick={() => setSelectionSurface('3d')}
                    className={`py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                      selectionSurface === '3d'
                        ? 'bg-white text-primary-deep shadow-sm'
                        : 'text-on-surface-muted'
                    }`}
                  >
                    3D Scene View
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectionSurface('frame');
                      if (activeFrame) {
                        const pose =
                          activeFrame.cameraPose ||
                          sceneData.cameraPoses.find((p) => p.frameId === activeFrame.id);
                        if (pose) viewportRef.current?.loadCameraPose(pose);
                      }
                    }}
                    className={`py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                      selectionSurface === 'frame'
                        ? 'bg-white text-primary-deep shadow-sm'
                        : 'text-on-surface-muted'
                    }`}
                  >
                    2D Reference Frame
                  </button>
                </div>

                {demoMode && sceneData.objects.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {sceneData.objects.map((obj) => (
                      <button
                        key={obj.id}
                        type="button"
                        onClick={() => {
                          setSelectedObjectId(obj.id);
                          handlePromptChange(obj.defaultPrompt);
                        }}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                          selectedObjectId === obj.id
                            ? 'bg-primary-container text-primary-deep border-primary/40 font-semibold'
                            : 'bg-surface-container-low text-on-surface-muted border-border-sand hover:text-on-surface'
                        }`}
                      >
                        {obj.shortName}
                      </button>
                    ))}
                  </div>
                )}

                {activeFrame && (
                  <div className="flex items-center justify-between text-[11px] text-on-surface-muted bg-surface-container-low/70 px-2.5 py-1.5 rounded-xl border border-border-sand">
                    <span>
                      Ref: <strong>#{activeFrame.index}</strong> ({frameNaturalSize.w}×
                      {frameNaturalSize.h}px)
                    </span>
                    <span className="font-semibold text-primary-deep">
                      {activeFramePoints.length} {activeFramePoints.length === 1 ? 'pin' : 'pins'}
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 pt-0.5">
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setPointMode('positive')}
                    className={`py-1.5 px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1 transition-all disabled:opacity-50 ${
                      pointMode === 'positive'
                        ? 'bg-primary-deep text-white shadow-sm'
                        : 'bg-surface-container hover:bg-surface-container-high text-on-surface border border-outline-variant/30'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px]">add_circle</span>
                    <span>+ Include</span>
                  </button>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setPointMode('negative')}
                    className={`py-1.5 px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1 transition-all disabled:opacity-50 ${
                      pointMode === 'negative'
                        ? 'bg-error text-white shadow-sm'
                        : 'bg-surface-container hover:bg-surface-container-high text-on-surface border border-outline-variant/30'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px]">remove_circle</span>
                    <span>- Exclude</span>
                  </button>
                </div>

                <div className="flex items-center justify-between text-[11px] text-on-surface-muted">
                  <span>
                    {selectionSurface === 'frame'
                      ? 'Click image to segment (or click pin to remove)'
                      : 'Switch to 2D Frame to place pixel clicks'}
                  </span>
                  {activeFramePoints.length > 0 && (
                    <button
                      type="button"
                      disabled={!canEdit || segmenting}
                      onClick={handleUndoPoint}
                      className="text-primary-deep font-semibold hover:underline shrink-0 ml-2 disabled:opacity-50"
                    >
                      Undo pin
                    </button>
                  )}
                </div>
              </section>

              {/* Step 2: Edit Prompt */}
              <section className="p-3.5 rounded-2xl bg-white/85 border border-outline-variant/30 shadow-sm flex flex-col gap-2.5">
                <span className="text-[10px] tracking-wider uppercase font-semibold text-primary-deep">
                  Step 02 • Describe Edit Prompt
                </span>
                <textarea
                  id="edit-prompt-input"
                  rows={2}
                  value={prompt}
                  disabled={!canEdit}
                  onChange={(e) => handlePromptChange(e.target.value)}
                  placeholder="Describe your desired furniture, material, or color..."
                  className="w-full p-2.5 rounded-xl border border-outline-variant/60 bg-white text-xs text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none shadow-inner disabled:opacity-60"
                />
                <div className="flex flex-wrap gap-1.5">
                  {PROMPT_CHIPS.map((chip) => {
                    const active = prompt.trim() === chip;
                    return (
                      <button
                        key={chip}
                        type="button"
                        disabled={!canEdit}
                        onClick={() => handlePromptChange(chip)}
                        className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors disabled:opacity-50 ${
                          active
                            ? 'bg-primary/10 border-primary/30 text-primary-deep font-semibold'
                            : 'bg-surface-container-low hover:bg-surface-container text-on-surface border-outline-variant/30'
                        }`}
                      >
                        {chip}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Step 3: Track Across Frames, Review Grid & Explicit Preview Approval */}
              <section className="p-3.5 rounded-2xl bg-white/85 border border-outline-variant/30 shadow-sm flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] tracking-wider uppercase font-semibold text-primary-deep">
                    Step 03 • Track, Review &amp; Approve
                  </span>
                  <span className="text-[10px] text-amber-800 font-medium bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                    {markedFrameCount}/{registeredFrames.length} Marked
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={
                      !canEdit ||
                      isTracking ||
                      !editSession ||
                      editSession.currentMaskRevision < 1
                    }
                    onClick={() => void handleRunTracking()}
                    className="py-1.5 px-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface text-[11px] font-semibold border border-outline-variant/40 flex items-center justify-center gap-1 disabled:opacity-55"
                  >
                    <span className="material-symbols-outlined text-[14px] text-primary">
                      track_changes
                    </span>
                    <span>{isTracking ? `Tracking ${trackingPct}%` : 'Track Frames'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFrameGridOpen(true)}
                    className="py-1.5 px-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface text-[11px] font-semibold border border-outline-variant/40 flex items-center justify-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[14px] text-secondary">
                      grid_view
                    </span>
                    <span>
                      Mark Frames{reviewDirty ? ' *' : ''}
                    </span>
                  </button>
                </div>

                {isTracking && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-on-surface-muted">
                      <span>{trackingTask?.substepMessage || 'Propagating masks...'}</span>
                      <span>{trackingPct}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden">
                      <div
                        className="h-full bg-secondary transition-all duration-300"
                        style={{ width: `${trackingPct}%` }}
                      />
                    </div>
                  </div>
                )}

                {editSession?.acceptanceInvalidated && !isCurrentPreviewAccepted && (
                  <div className="px-2.5 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                    Prior approval cleared because reference frame, mask, or prompt changed.
                    Generate or accept a matching preview before batch editing.
                  </div>
                )}

                <button
                  type="button"
                  disabled={
                    !canEdit ||
                    generatingPreview ||
                    !editSession ||
                    editSession.currentMaskRevision < 1 ||
                    !prompt.trim()
                  }
                  onClick={() => void handleGeneratePreview()}
                  className="w-full py-2 px-3 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold border border-outline-variant/40 flex items-center justify-center gap-1.5 disabled:opacity-55"
                >
                  <span
                    className={`material-symbols-outlined text-[15px] text-secondary ${
                      generatingPreview ? 'animate-spin' : ''
                    }`}
                  >
                    {displayedPreview ? 'refresh' : 'auto_fix_high'}
                  </span>
                  <span>
                    {generatingPreview
                      ? 'Generating Preview...'
                      : displayedPreview
                        ? 'Regenerate Seed Preview'
                        : 'Generate Reference Preview'}
                  </span>
                </button>

                {displayedPreview && (
                  <div className="rounded-xl overflow-hidden border border-outline-variant/40 bg-surface-container-low space-y-2 p-2">
                    <div className="relative h-32 rounded-lg overflow-hidden bg-stone-950">
                      <ArtifactImage
                        src={displayedPreview.previewImageUrl}
                        alt={`Preview ${displayedPreview.previewId}`}
                        className="w-full h-full object-contain"
                      />
                      <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/70 text-white text-[10px] font-mono">
                        {displayedPreview.previewId}
                      </div>
                      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full bg-black/70 text-white text-[10px]">
                        Seed #{displayedPreview.seed}
                      </div>
                      <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full bg-black/70 text-white text-[10px]">
                        Mask rev #{displayedPreview.maskRevision}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[10px] text-on-surface-muted px-0.5">
                      <span>
                        Ref: <strong>{displayedPreview.referenceFrameId}</strong>
                        {displayedPreview.precision ? ` • ${displayedPreview.precision}` : ''}
                        {displayedPreview.elapsedSec
                          ? ` • ${displayedPreview.elapsedSec.toFixed(1)}s`
                          : ''}
                      </span>
                      <span
                        className={`font-semibold ${
                          isCurrentPreviewAccepted ? 'text-emerald-700' : 'text-amber-800'
                        }`}
                      >
                        {isCurrentPreviewAccepted ? 'Accepted ✓' : 'Awaiting Approval'}
                      </span>
                    </div>

                    <button
                      type="button"
                      disabled={!canEdit || acceptingPreview || isCurrentPreviewAccepted || reviewDirty}
                      onClick={() => void handleAcceptPreview()}
                      className={`w-full py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                        isCurrentPreviewAccepted
                          ? 'bg-emerald-700 text-white cursor-default'
                          : 'bg-primary text-white hover:bg-primary-hover disabled:opacity-55'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[15px]">
                        {isCurrentPreviewAccepted ? 'verified' : 'thumb_up'}
                      </span>
                      <span>
                        {acceptingPreview
                          ? 'Locking Approval...'
                          : isCurrentPreviewAccepted
                            ? 'Preview Accepted'
                            : 'Accept Preview'}
                      </span>
                    </button>
                  </div>
                )}
              </section>

              {/* Step 4: Batch Diffusion & 3DGS Rebuild */}
              <section className="p-3.5 rounded-2xl bg-surface-container-low/70 border border-outline-variant/30 flex flex-col gap-2.5 mt-auto">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[10px] tracking-wider uppercase font-semibold text-primary-deep">
                    Step 04 • Batch Edit &amp; Rebuild
                  </span>
                  <div className="flex items-center gap-1 rounded-lg bg-white p-0.5 border border-border-sand">
                    {(['finetune', 'scratch'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        disabled={isPipelineRunning}
                        onClick={() => setRebuildMode(m)}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-semibold capitalize ${
                          rebuildMode === m
                            ? 'bg-primary text-white'
                            : 'text-on-surface-muted hover:text-on-surface'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                {rebuildStage !== 'idle' && (
                  <div className="space-y-1 pb-0.5">
                    <div className="flex justify-between text-[11px] font-medium text-on-surface-muted">
                      <span className="truncate pr-2">
                        {rebuildStage === 'diffusion'
                          ? `Diffusion editing frame ${diffusionFrameIndex} of ${markedFrameCount}...`
                          : rebuildStage === 'rebuilding'
                            ? rebuildTask?.substepMessage ||
                              `Rebuilding 3DGS (${rebuildMode}, poses kept)...`
                            : rebuildStage === 'done'
                              ? 'Edited 3D scene published!'
                              : 'Pipeline stopped with error'}
                      </span>
                      <span className="font-semibold text-primary-deep shrink-0">
                        {rebuildPct}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          rebuildStage === 'error' ? 'bg-error' : 'bg-primary'
                        }`}
                        style={{ width: `${rebuildPct}%` }}
                      />
                    </div>
                    {rebuildStage === 'rebuilding' && rebuildTask && rebuildTask.iterationsTotal > 0 && (
                      <div className="text-[10px] text-on-surface-muted font-mono">
                        {rebuildTask.iterationsDone.toLocaleString()} /{' '}
                        {rebuildTask.iterationsTotal.toLocaleString()} iters
                        {batchTask?.peakVramGb ? ` • ${batchTask.peakVramGb.toFixed(2)} GB VRAM` : ''}
                      </div>
                    )}
                  </div>
                )}

                {pipelineError && (
                  <div className="p-2 rounded-xl bg-error/10 border border-error/30 text-[11px] text-error">
                    {pipelineError}
                  </div>
                )}

                <button
                  type="button"
                  disabled={
                    !canEdit ||
                    isPipelineRunning ||
                    !isCurrentPreviewAccepted ||
                    markedFrameCount === 0 ||
                    reviewDirty
                  }
                  onClick={() => void handleRunBatchAndRebuild()}
                  className={`w-full py-2.5 px-4 rounded-xl text-white text-xs font-semibold shadow-md flex items-center justify-center gap-2 transition-all disabled:opacity-50 ${
                    rebuildStage === 'done'
                      ? 'bg-emerald-700 hover:bg-emerald-800'
                      : 'bg-primary-deep hover:bg-primary-container-deep shadow-primary/25'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {rebuildStage === 'done' ? 'check_circle' : 'deployed_code'}
                  </span>
                  <span>
                    {isPipelineRunning
                      ? 'Processing Batch & Rebuild...'
                      : !isCurrentPreviewAccepted
                        ? 'Accept Preview to Unlock Batch Edit'
                        : `Apply to 3D Room (${markedFrameCount} frames)`}
                  </span>
                </button>
              </section>
            </div>
          </aside>
        </div>
      </main>

      {/* Bottom Status Bar */}
      <footer className="w-full bg-white/90 backdrop-blur-md border-t border-outline-variant/30 py-2.5 px-6 shrink-0 z-40">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-on-surface-muted font-medium">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1.5 text-primary-deep font-semibold">
              <span className="w-2 h-2 rounded-full bg-primary-deep" />
              {resolvedProject.name}
            </span>
            <span className="text-outline-variant">•</span>
            <span>
              {cameraMode === 'fly'
                ? 'WASD + Q/E + Mouse Drag to Free-Fly'
                : 'Drag to Orbit • Scroll to Zoom • Select 2D Frame to Segment'}
            </span>
            <span className="text-outline-variant">•</span>
            <span className="text-on-surface font-semibold">{fps} FPS</span>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-outline">
            <span>
              {sceneData.gaussianCount > 0
                ? `${sceneData.gaussianCount.toLocaleString()} Gaussians`
                : sceneData.roomDimensions}
            </span>
            <span>•</span>
            <span>{demoMode ? 'Demo Sandbox' : 'Live Artifact Studio'}</span>
          </div>
        </div>
      </footer>

      <FrameMaskGridModal
        open={frameGridOpen}
        onClose={() => setFrameGridOpen(false)}
        frames={sampledFrames}
        activeFrameId={activeFrameId}
        perFramePoints={perFramePoints}
        canEdit={canEdit}
        savingReview={savingReview}
        resegmentingFrameId={resegmentingFrameId}
        onToggleFrameMark={(fid) => {
          setSampledFrames((prev) =>
            prev.map((f) =>
              f.id === fid
                ? { ...f, userMarked: !f.userMarked, includeInEdit: !f.userMarked }
                : f
            )
          );
          setReviewDirty(true);
          invalidateAcceptanceLocally();
        }}
        onSelectReferenceFrame={(fid) => {
          void handleSelectReferenceFrame(fid);
          setSelectionSurface('frame');
        }}
        onSelectAllDetected={() => {
          setSampledFrames((prev) =>
            prev.map((f) =>
              f.registered === false
                ? f
                : { ...f, userMarked: f.hasObject, includeInEdit: f.hasObject }
            )
          );
          setReviewDirty(true);
          invalidateAcceptanceLocally();
        }}
        onPlaceHintAndResegment={(fid, pts) =>
          runSegmentationForFrame(fid, pts, fid === activeFrameId)
        }
        onSaveReview={handleSaveFrameReview}
      />

      <AtelierModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title={`Share "${resolvedProject.name}"`}
        subtitle="Browser-ready 3D Gaussian Splat walkthrough link"
        icon="share"
      >
        <div className="space-y-4 text-xs">
          <p className="text-on-surface-muted">
            {demoMode
              ? 'Demo Sandbox walkthrough preview link:'
              : 'Generate a revocable read-only link so clients can explore this 3D room in any browser without signing in.'}
          </p>

          {!demoMode && (
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={shareLabel}
                onChange={(e) => setShareLabel(e.target.value)}
                placeholder="Share label (e.g. Client Review)"
                aria-label="Share label"
                className="flex-1 px-3.5 py-2 rounded-xl bg-surface-container-low border border-border-sand text-xs text-on-surface focus:outline-none focus:border-primary"
              />
              <button
                type="button"
                disabled={creatingShare || !canShare}
                onClick={() => void handleCreateAndCopyShare()}
                className="px-4 py-2 rounded-full bg-primary text-white font-semibold hover:bg-primary-hover transition-colors disabled:opacity-60 shrink-0"
              >
                {creatingShare ? 'Creating...' : 'Create & Copy Share Link'}
              </button>
            </div>
          )}

          {latestShareUrl && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-surface-container-low border border-border-sand">
              <input
                readOnly
                value={latestShareUrl}
                aria-label="Shareable walkthrough URL"
                className="flex-1 bg-transparent text-xs text-on-surface font-mono focus:outline-none"
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(latestShareUrl);
                    showToast('Studio walkthrough URL copied!', 'success');
                  } catch {
                    showToast('Copy failed — copy the URL manually.', 'info');
                  }
                }}
                className="px-4 py-1.5 rounded-full bg-primary text-white font-semibold hover:bg-primary-hover transition-colors"
              >
                Copy
              </button>
            </div>
          )}

          {!demoMode && (
            <div className="space-y-2 pt-2 border-t border-border-sand/70">
              <p className="font-semibold text-on-surface">Issued Share Links</p>
              {sharesLoading ? (
                <p className="text-on-surface-muted">Loading shares...</p>
              ) : shares.length === 0 ? (
                <p className="text-on-surface-muted">No share links issued yet.</p>
              ) : (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {shares.map((s) => (
                    <div
                      key={s.shareId}
                      className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-surface-container-low border border-border-sand/60"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-on-surface truncate">{s.label}</p>
                        <p className="text-[11px] text-on-surface-muted">
                          {s.isActive ? 'Active' : 'Revoked / Expired'} • Expires{' '}
                          {new Date(s.expiresAt).toLocaleDateString()}
                        </p>
                      </div>
                      {s.isActive && canShare && (
                        <button
                          type="button"
                          onClick={() => void handleRevokeShare(s.shareId)}
                          className="px-3 py-1 rounded-full bg-error-container text-error font-semibold hover:opacity-80 shrink-0"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </AtelierModal>
    </div>
  );
};
