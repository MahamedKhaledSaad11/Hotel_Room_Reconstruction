import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppHeader } from '../components/layout/AppHeader';
import { AppFooter } from '../components/layout/AppFooter';
import { useAuth } from '../context/AuthContext';
import { useProjects } from '../context/ProjectsContext';
import { useToast } from '../context/ToastContext';
import { PipelineStageId, StageDetail } from '../types';

const STAGE_ORDER: PipelineStageId[] = [
  'extracting_frames',
  'estimating_poses',
  'training_3dgs',
  'exporting_splat',
];

export const ProgressPage: React.FC = () => {
  const { taskId } = useParams<{ taskId?: string }>();
  const { demoMode } = useAuth();
  const {
    tasks,
    activeTaskId,
    cancelTask,
    refreshTaskFromBackend,
  } = useProjects();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const showTelemetry = true;
  const [notifyActive, setNotifyActive] = useState(false);
  const [fetchingTask, setFetchingTask] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Recover task cleanly on page reload or direct deep link /progress/:taskId
  useEffect(() => {
    if (!taskId) return;
    if (demoMode && tasks[taskId]) return;
    let active = true;
    setFetchingTask(true);
    setFetchError(null);
    void refreshTaskFromBackend(taskId)
      .then((res) => {
        if (!active) return;
        if (!res) {
          setFetchError(`Task "${taskId}" was not found for this session.`);
        }
      })
      .catch((err) => {
        if (!active) return;
        setFetchError(
          err instanceof Error && err.message
            ? err.message
            : `Unable to load task "${taskId}".`
        );
      })
      .finally(() => {
        if (active) setFetchingTask(false);
      });
    return () => {
      active = false;
    };
  }, [taskId, demoMode, refreshTaskFromBackend]);

  // Never fall back to an unrelated task when an explicit :taskId was requested
  const task = taskId
    ? tasks[taskId]
    : activeTaskId
      ? tasks[activeTaskId]
      : Object.values(tasks)[0];

  const prevStatusRef = useRef<string | undefined>(task?.status);
  useEffect(() => {
    if (!task) return;
    if (
      notifyActive &&
      prevStatusRef.current &&
      prevStatusRef.current !== 'completed' &&
      task.status === 'completed'
    ) {
      showToast(`"${task.projectName}" 3D room is ready to explore!`, 'success');
    }
    prevStatusRef.current = task.status;
  }, [task, notifyActive, showToast]);

  const stages: StageDetail[] = useMemo(() => {
    if (!task) return [];
    const currentIdx = STAGE_ORDER.indexOf(task.stage);
    const isAllDone = task.status === 'completed';
    const isQueued = task.status === 'queued';

    const defs: Omit<StageDetail, 'status'>[] = [
      {
        id: 'extracting_frames',
        stepNumber: 'STAGE 01',
        humanTitle: 'Reading Video Frames',
        technicalStage: 'Extracting Frames (ffmpeg)',
        description:
          task.extractedFrames > 0
            ? `${task.extractedFrames} retained frames @ ${task.fps} fps (max ${task.maxLongSide}px).`
            : `Configured ${task.fps} fps (max ${task.maxLongSide}px long side).`,
        metricLabel:
          task.droppedFrames && task.droppedFrames > 0
            ? `${task.droppedFrames} blurry frames dropped`
            : task.dropBlurry
              ? 'Laplacian blur filter enabled'
              : 'Blur filter disabled',
        icon: 'videocam',
      },
      {
        id: 'estimating_poses',
        stepNumber: 'STAGE 02',
        humanTitle: 'Mapping Room Architecture',
        technicalStage: `Estimating Poses (${task.poseEstimator})`,
        description: 'Sequential matching & sparse camera alignment to COLMAP sparse/0.',
        metricLabel:
          task.registeredFrames > 0
            ? `${task.registeredFrames}/${task.extractedFrames} cameras registered`
            : 'Awaiting pose estimation',
        icon: 'floor_lamp',
      },
      {
        id: 'training_3dgs',
        stepNumber: 'STAGE 03',
        humanTitle: 'Building Spatial Geometry',
        technicalStage: 'Training 3DGS',
        description: 'Optimizing 3D Gaussian primitives initialized from sparse cloud.',
        metricLabel:
          task.iterationsDone > 0
            ? `${task.iterationsDone.toLocaleString()} / ${task.iterationsTotal.toLocaleString()} iters`
            : `Target: ${task.iterationsTotal.toLocaleString()} iterations`,
        icon: 'square_foot',
      },
      {
        id: 'exporting_splat',
        stepNumber: 'STAGE 04',
        humanTitle: 'Exporting Web Splat',
        technicalStage: 'Exporting (.ply → .splat)',
        description: 'Persisting checkpoint, .ply, sparse cloud & compact browser .splat.',
        metricLabel:
          task.gaussiansCount > 0
            ? `${task.gaussiansCount.toLocaleString()} Gaussians`
            : 'Awaiting export',
        icon: 'flare',
      },
    ];

    return defs.map((def, idx) => {
      let status: StageDetail['status'] = 'pending';
      if (isAllDone || idx < currentIdx) status = 'completed';
      else if (idx === currentIdx && !isQueued) status = 'active';
      return { ...def, status };
    });
  }, [task]);

  if (!task && fetchingTask) {
    return (
      <div className="min-h-screen flex flex-col bg-surface-warm text-on-surface">
        <AppHeader />
        <main className="flex-1 pt-28 pb-16 flex flex-col items-center justify-center px-6 text-center">
          <span className="material-symbols-outlined text-4xl text-primary animate-spin mb-3">
            progress_activity
          </span>
          <h1 className="font-headline text-2xl text-on-surface">Loading Task Status...</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Fetching pipeline telemetry for <code className="font-mono">{taskId}</code>
          </p>
        </main>
        <AppFooter />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="min-h-screen flex flex-col bg-surface-warm text-on-surface">
        <AppHeader />
        <main className="flex-1 pt-28 pb-16 flex flex-col items-center justify-center px-6 text-center">
          <span className="material-symbols-outlined text-4xl text-primary mb-3">
            {taskId ? 'search_off' : 'view_in_ar'}
          </span>
          <h1 className="font-headline text-3xl text-on-surface">
            {taskId ? 'Reconstruction Task Not Found' : 'No Active Scan Found'}
          </h1>
          <p className="text-sm text-on-surface-variant mt-2 max-w-md">
            {fetchError ||
              (taskId
                ? `No reconstruction task matching "${taskId}" exists in your current session.`
                : 'Upload a room walkthrough video to watch the 4-stage 3D Gaussian Splatting pipeline.')}
          </p>
          <div className="mt-6 flex items-center gap-3">
            <Link
              to="/spaces"
              className="px-5 py-2.5 rounded-full bg-surface-container text-on-surface text-sm font-semibold"
            >
              My Spaces
            </Link>
            <Link
              to="/scan"
              className="px-6 py-2.5 rounded-full bg-primary text-white text-sm font-semibold"
            >
              Scan a New Room
            </Link>
          </div>
        </main>
        <AppFooter />
      </div>
    );
  }

  const isCompleted = task.status === 'completed';
  const isQueued = task.status === 'queued';
  const isPaused = task.status === 'paused';
  const isCancelled = task.status === 'cancelled';
  const isError = task.status === 'failed' || task.status === 'error';

  const handleCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      await cancelTask(task.id);
      showToast('Scan cancelled and saved as draft', 'info');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to cancel reconstruction task.',
        'error'
      );
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-surface-warm text-on-surface">
      <AppHeader />

      <main className="w-full pt-24 pb-16 flex-1">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col gap-8">
          {/* Error Banner when pipeline fails */}
          {isError && (
            <div
              role="alert"
              className="rounded-2xl bg-error-container border border-error/30 text-on-error-container px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-error text-[22px] mt-0.5">
                  error
                </span>
                <div>
                  <h2 className="text-sm font-semibold">Reconstruction Pipeline Failed</h2>
                  <p className="text-xs mt-0.5">
                    {task.error ||
                      'Worker reported an unexpected failure during GPU processing. You can retry from My Spaces.'}
                  </p>
                </div>
              </div>
              <Link
                to="/spaces"
                className="px-4 py-2 rounded-full bg-error text-white text-xs font-semibold shrink-0 self-start sm:self-auto"
              >
                Return to Spaces
              </Link>
            </div>
          )}

          {/* Queued Worker Banner */}
          {isQueued && (
            <div className="rounded-2xl bg-secondary-fixed/40 border border-secondary/30 text-on-surface px-5 py-3.5 flex items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-3 text-xs">
                <span className="material-symbols-outlined text-secondary text-[20px] animate-pulse">
                  hourglass_top
                </span>
                <span>
                  <strong>Queued for Kaggle 2×T4 Worker</strong> — task{' '}
                  <code className="font-mono">{task.id}</code> is persisted and waiting for an
                  available worker to claim it. Refreshing this page will automatically resume
                  tracking.
                </span>
              </div>
            </div>
          )}

          {/* Top Card: Room Header & Progress */}
          <section className="bg-surface-container-lowest rounded-2xl p-7 md:p-8 shadow-sm border border-outline-variant/40 flex flex-col gap-6 relative overflow-hidden">
            <div className="absolute -top-16 -right-16 w-64 h-64 bg-secondary-fixed/40 rounded-full blur-3xl pointer-events-none" />

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary-deep/10 text-primary-deep text-xs font-medium tracking-wide">
                    <span className="material-symbols-outlined text-[13px]">wb_sunny</span>
                    {task.scanBadge}
                  </span>
                  <span className="text-xs text-on-surface-muted font-medium">
                    Interior Photogrammetry • {task.poseEstimator} + 3DGS
                    {demoMode ? ' (Demo Sandbox)' : ' (Live Pipeline)'}
                  </span>
                </div>

                <h1 className="font-headline text-2xl md:text-3xl text-on-surface font-normal">
                  {isCompleted
                    ? 'Your 3D Room is Ready: '
                    : isError
                      ? 'Reconstruction Halted: '
                      : isQueued
                        ? 'Queued for 3D Reconstruction: '
                        : 'Creating Your 3D Room: '}
                  <span className="font-medium text-primary-deep italic">{task.projectName}</span>
                </h1>

                <p className="text-xs md:text-sm text-on-surface-muted flex items-center gap-1.5 mt-0.5">
                  <span className="material-symbols-outlined text-secondary text-[16px]">
                    {task.peakVramGb > 0 ? 'memory' : 'cloud_queue'}
                  </span>
                  {task.peakVramGb > 0
                    ? `Measured Peak VRAM: ${task.peakVramGb.toFixed(2)} GB`
                    : isQueued
                      ? 'Waiting for worker telemetry...'
                      : 'Awaiting worker resource telemetry'}
                  {task.wallTimeSec && task.wallTimeSec > 0
                    ? ` • Elapsed ${task.wallTimeSec.toFixed(1)}s`
                    : ''}
                </p>
              </div>

              <div className="flex flex-col md:items-end gap-3 shrink-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl md:text-4xl font-headline font-medium text-primary-deep tracking-tight">
                    {task.progress}%
                  </span>
                  <span className="text-sm font-medium text-on-surface-muted">
                    {isCompleted
                      ? '· Reconstruction complete'
                      : isError
                        ? '· Pipeline error'
                        : isQueued
                          ? '· Queued'
                          : isPaused
                            ? '· Paused'
                            : isCancelled
                              ? '· Cancelled'
                              : demoMode
                                ? `· Ready in ~${task.estimatedMinutes} min`
                                : '· Running on worker'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isCompleted ? (
                    <Link
                      to={`/studio/${task.projectId}`}
                      className="px-5 py-2.5 rounded-full bg-primary hover:bg-primary-hover text-white text-xs font-semibold flex items-center gap-2 shadow-soft transition-all"
                    >
                      <span className="material-symbols-outlined text-[16px]">visibility</span>
                      <span>Step Inside 3D Room</span>
                    </Link>
                  ) : (
                    !isCancelled &&
                    !isError && (
                      <>


                        <button
                          type="button"
                          disabled={cancelling}
                          onClick={() => void handleCancel()}
                          className="px-3.5 py-2 rounded-xl bg-surface-container-low hover:bg-error-container text-on-surface-muted hover:text-error text-xs font-medium transition-all border border-outline-variant/30 disabled:opacity-60"
                        >
                          {cancelling ? 'Cancelling...' : 'Cancel'}
                        </button>


                      </>
                    )
                  )}

                  {(isCancelled || isError) && (
                    <Link
                      to="/spaces"
                      className="px-4 py-2 rounded-xl bg-surface-container text-on-surface text-xs font-semibold"
                    >
                      Back to My Spaces
                    </Link>
                  )}
                </div>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="flex flex-col gap-2 relative z-10">
              <div className="w-full h-3 bg-surface-container-high rounded-full overflow-hidden p-0.5">
                <div
                  className="h-full bg-gradient-to-r from-secondary-container via-primary-container-deep to-primary-deep rounded-full transition-all duration-700 shadow-sm relative"
                  style={{ width: `${task.progress}%` }}
                >
                  {!isCompleted && !isPaused && !isCancelled && !isError && !isQueued && (
                    <div className="absolute right-0 top-0 bottom-0 w-2 bg-white/40 rounded-full animate-pulse" />
                  )}
                </div>
              </div>
              <div className="flex flex-wrap justify-between items-center text-xs text-on-surface-muted gap-2">
                <span>Video uploaded &amp; validated</span>
                <span className="text-primary-deep font-medium">
                  {task.substepMessage || (isQueued ? 'Awaiting worker claim' : '')}
                </span>
                <span>3DGS + .splat export</span>
              </div>
            </div>
          </section>

          {/* 4-Stage Pipeline Stepper */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {stages.map((stage) => {
              const isStageActive = stage.status === 'active';
              const isStageDone = stage.status === 'completed';

              return (
                <div
                  key={stage.id}
                  className={`rounded-2xl p-5 flex flex-col justify-between gap-3 relative overflow-hidden transition-colors ${
                    isStageActive
                      ? 'bg-surface-container-low border-2 border-primary/50 shadow-sm'
                      : 'bg-surface-container-lowest border border-outline-variant/40 shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-[11px] tracking-wider uppercase font-bold ${
                        isStageActive ? 'text-primary-deep' : 'text-on-surface-muted'
                      }`}
                    >
                      {stage.stepNumber}
                    </span>

                    {isStageDone && (
                      <span className="inline-flex items-center text-tertiary-deep bg-tertiary-fixed/70 px-2 py-0.5 rounded-full text-xs font-medium">
                        <span className="material-symbols-outlined text-[15px] mr-1 icon-filled">
                          check
                        </span>
                        Completed
                      </span>
                    )}
                    {isStageActive && (
                      <span className="inline-flex items-center text-primary-deep bg-primary-fixed px-2 py-0.5 rounded-full text-xs font-semibold">
                        <span className="material-symbols-outlined text-[15px] mr-1 animate-spin">
                          progress_activity
                        </span>
                        In Progress
                      </span>
                    )}
                    {stage.status === 'pending' && (
                      <span className="inline-flex items-center text-outline bg-surface-container px-2 py-0.5 rounded-full text-xs font-medium">
                        Queued
                      </span>
                    )}
                  </div>

                  <div>
                    <h2
                      className={`text-base font-semibold mb-0.5 ${
                        isStageActive ? 'text-primary-deep' : 'text-on-surface'
                      }`}
                    >
                      {stage.humanTitle}
                    </h2>
                    <p className="text-[11px] font-semibold text-secondary mb-1">
                      {stage.technicalStage}
                    </p>
                    <p className="text-xs text-on-surface-muted leading-relaxed">
                      {stage.description}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-surface-container-high flex items-center gap-1.5 text-xs text-on-surface-muted">
                    <span
                      className={`material-symbols-outlined text-[15px] ${
                        isStageActive ? 'text-secondary' : 'text-tertiary-deep'
                      }`}
                    >
                      {stage.icon}
                    </span>
                    <span>{stage.metricLabel}</span>
                  </div>
                </div>
              );
            })}
          </section>

          {/* Telemetry & Measured Metrics */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            <div className="lg:col-span-7 bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/40 shadow-sm flex flex-col gap-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-secondary-fixed/50 text-secondary flex items-center justify-center">
                    <span className="material-symbols-outlined text-[18px]">terminal</span>
                  </div>
                  <div>
                    <h2 className="font-headline text-xl text-on-surface font-semibold">
                      {showTelemetry || !demoMode
                        ? 'Pipeline Worker Telemetry'
                        : 'Interactive Preview Forming'}
                    </h2>
                    <p className="text-xs text-on-surface-muted">
                      Live stage progress &amp; GPU metrics reported via GET /tasks/{task.id}
                    </p>
                  </div>
                </div>


              </div>

              {showTelemetry || !demoMode ? (
                <div className="w-full flex-1 min-h-[340px] rounded-xl bg-inverse-surface text-inverse-on-surface p-5 font-mono text-xs flex flex-col justify-between gap-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-3 border-b border-white/10">
                    <div>
                      <span className="text-[10px] uppercase text-white/50 block">Stage</span>
                      <span className="text-secondary-fixed font-semibold">{task.stage}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-white/50 block">Cameras</span>
                      <span>
                        {task.registeredFrames}/{task.extractedFrames}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-white/50 block">3DGS Iter</span>
                      <span>
                        {task.iterationsDone.toLocaleString()}/
                        {task.iterationsTotal.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-white/50 block">Peak VRAM</span>
                      <span>
                        {task.peakVramGb > 0 ? `${task.peakVramGb.toFixed(2)} GB` : 'Pending'}
                      </span>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2 max-h-60 atelier-scroll">
                    {task.logs.length > 0 ? (
                      task.logs.map((line, i) => (
                        <div key={i} className="text-white/85 leading-relaxed">
                          {line}
                        </div>
                      ))
                    ) : (
                      <div className="text-white/50">
                        Waiting for worker logs...
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="w-full flex-1 min-h-[340px] bg-gradient-to-b from-surface-container-high/40 to-surface-container-low rounded-xl border border-outline-variant/30 relative overflow-hidden flex items-center justify-center p-6">
                  <div className="relative z-10 w-full flex flex-col items-center justify-center text-center gap-3">
                    <span className="material-symbols-outlined text-4xl text-primary-deep">
                      view_in_ar
                    </span>
                    <p className="text-sm font-medium text-on-surface">
                      Demo Preview Simulation Active
                    </p>
                    <p className="text-xs text-on-surface-variant max-w-sm">
                      {task.substepMessage}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between text-xs text-on-surface-muted px-1 pt-1 gap-2">
                <span className="flex items-center gap-1 text-on-surface">
                  <span className="material-symbols-outlined text-[16px] text-tertiary-deep">
                    check_circle
                  </span>
                  COLMAP artifacts persisted for Week 2
                </span>
                <span className="text-xs text-primary-deep font-medium">
                  Task ID: <code className="font-mono">{task.id}</code>
                </span>
              </div>
            </div>

            <div className="lg:col-span-5 flex flex-col gap-4">
              <div className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/40 shadow-sm flex flex-col gap-5 flex-1">
                <div className="flex items-center justify-between pb-3 border-b border-surface-container-high">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-tertiary-fixed/60 text-tertiary-deep flex items-center justify-center">
                      <span className="material-symbols-outlined text-[18px]">analytics</span>
                    </div>
                    <div>
                      <h3 className="text-base text-on-surface font-semibold">
                        Measured Pipeline Metrics
                      </h3>
                      <p className="text-xs text-on-surface-muted">
                        Authoritative telemetry reported by the worker
                      </p>
                    </div>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-md bg-surface-container-high text-on-surface-muted font-medium uppercase">
                    {task.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 flex-1">
                  <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/30">
                    <span className="text-[10px] font-semibold text-on-surface-muted uppercase">
                      Extracted / Dropped
                    </span>
                    <p className="text-lg font-headline text-on-surface mt-1">
                      {task.extractedFrames}{' '}
                      <span className="text-xs text-on-surface-muted">
                        ({task.droppedFrames ?? 0} blurry)
                      </span>
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/30">
                    <span className="text-[10px] font-semibold text-on-surface-muted uppercase">
                      Registered Cameras
                    </span>
                    <p className="text-lg font-headline text-on-surface mt-1">
                      {task.registeredFrames}
                      <span className="text-xs text-on-surface-muted">
                        /{task.extractedFrames || 0}
                      </span>
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/30">
                    <span className="text-[10px] font-semibold text-on-surface-muted uppercase">
                      Gaussians Exported
                    </span>
                    <p className="text-lg font-headline text-on-surface mt-1">
                      {task.gaussiansCount > 0 ? task.gaussiansCount.toLocaleString() : '—'}
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/30">
                    <span className="text-[10px] font-semibold text-on-surface-muted uppercase">
                      Peak GPU VRAM
                    </span>
                    <p className="text-lg font-headline text-on-surface mt-1">
                      {task.peakVramGb > 0 ? `${task.peakVramGb.toFixed(2)} GB` : '—'}
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-surface-container-high flex items-center justify-between">
                  <span className="text-xs text-on-surface-muted">
                    Cap: {task.maxLongSide}px • {task.fps} fps • {task.poseEstimator}
                  </span>
                  <button
                    type="button"
                    disabled={!isCompleted}
                    onClick={() => navigate(`/studio/${task.projectId}`)}
                    className="text-xs text-primary-deep font-semibold hover:underline flex items-center gap-1 disabled:opacity-40 disabled:no-underline"
                  >
                    <span>Open 3D Viewer</span>
                    <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                  </button>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-secondary text-[20px]">
                    notifications_active
                  </span>
                  <span className="text-xs text-on-surface-muted">
                    Show a completion alert while this page is open.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNotifyActive((v) => !v);
                    showToast(
                      notifyActive
                        ? 'Completion alert muted'
                        : 'A completion alert will appear in this tab.',
                      'success'
                    );
                  }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors shrink-0 ${
                    notifyActive
                      ? 'bg-primary text-white border-primary'
                      : 'bg-surface-container-lowest text-primary-deep border-outline-variant/40 hover:bg-surface-container'
                  }`}
                >
                  {notifyActive ? 'Alerts On ✓' : 'Notify Me'}
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>

      <AppFooter />
    </div>
  );
};
