import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../components/layout/AppHeader';
import { AppFooter } from '../components/layout/AppFooter';
import { SafeImage } from '../components/common/SafeImage';
import { useAuth } from '../context/AuthContext';
import { useProjects } from '../context/ProjectsContext';
import { useToast } from '../context/ToastContext';
import { STITCH_IMAGES } from '../data/mockData';
import { Project, ProjectCategory, QualityMode } from '../types';

export const ScanRoomPage: React.FC = () => {
  const { demoMode } = useAuth();
  const { createDraftProject, uploadAndReconstructProject } = useProjects();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);
  const activeUrlRef = useRef<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [videoFileName, setVideoFileName] = useState(
    demoMode ? 'living_room_42_maple.mov' : ''
  );
  const [videoSizeMb, setVideoSizeMb] = useState(demoMode ? 1228 : 0);
  const [videoDurationSec, setVideoDurationSec] = useState(demoMode ? 148 : 0);
  const [videoWidth, setVideoWidth] = useState(demoMode ? 3840 : 0);
  const [videoHeight, setVideoHeight] = useState(demoMode ? 2160 : 0);

  const [roomName, setRoomName] = useState(
    demoMode ? 'Living Room - 42 Maple Ave' : ''
  );
  const [category, setCategory] = useState<ProjectCategory>('living');
  const [qualityMode, setQualityMode] = useState<QualityMode>('atelier');
  const [autoDimensions, setAutoDimensions] = useState(true);
  const [fps, setFps] = useState<1 | 2 | 3 | 4>(2);
  const [maxLongSide, setMaxLongSide] = useState<640 | 768 | 960>(960);
  const [dropBlurryFrames, setDropBlurryFrames] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pendingProject, setPendingProject] = useState<Project | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Single lifecycle owner for revoking object URLs on change or unmount
  useEffect(() => {
    activeUrlRef.current = previewUrl;
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleVideoFile = (file: File) => {
    if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v)$/i.test(file.name)) {
      showToast('Please select a valid video file (.mp4, .mov, .webm).', 'warning');
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setPreviewUrl(objectUrl);
    setUploadError(null);
    setVideoFileName(file.name);
    setVideoSizeMb(Math.max(1, Math.round(file.size / (1024 * 1024))));

    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.src = objectUrl;
    probe.onloadedmetadata = () => {
      if (!mountedRef.current || activeUrlRef.current !== objectUrl) return;
      if (Number.isFinite(probe.duration) && probe.duration > 0) {
        setVideoDurationSec(Math.round(probe.duration));
      }
      if (probe.videoWidth && probe.videoHeight) {
        setVideoWidth(probe.videoWidth);
        setVideoHeight(probe.videoHeight);
      }
    };

    const inferredName = file.name
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    if (inferredName && !roomName.trim()) {
      setRoomName(inferredName);
    } else if (inferredName && !pendingProject) {
      setRoomName(inferredName);
    }
    showToast(`Loaded "${file.name}" for spatial capture`, 'success');
  };

  const resetToSampleVideo = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setUploadError(null);
    if (demoMode) {
      setVideoFileName('living_room_42_maple.mov');
      setVideoSizeMb(1228);
      setVideoDurationSec(148);
      setVideoWidth(3840);
      setVideoHeight(2160);
      setRoomName('Living Room - 42 Maple Ave');
      showToast('Loaded sample 4K walkthrough capture (Demo Mode)', 'info');
    } else {
      setVideoFileName('');
      setVideoSizeMb(0);
      setVideoDurationSec(0);
      setVideoWidth(0);
      setVideoHeight(0);
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const hasVideoReady = demoMode ? Boolean(selectedFile || videoFileName) : Boolean(selectedFile);
  const durationWithinIdeal = videoDurationSec >= 120 && videoDurationSec <= 300;
  const estimatedExtractedFrames =
    videoDurationSec > 0
      ? Math.max(1, Math.round(videoDurationSec * fps))
      : 0;

  const handleSubmit = async () => {
    if (!demoMode && !selectedFile) {
      showToast('Please select a room walkthrough video file (.mp4, .mov, .webm) first.', 'warning');
      return;
    }
    if (!roomName.trim()) {
      showToast('Please give your room a name before generating.', 'warning');
      return;
    }
    setSubmitting(true);
    setUploadError(null);
    const config = {
      roomName,
      category,
      qualityMode,
      autoDimensions,
      fps,
      maxLongSide,
      dropBlurryFrames,
      videoFileName: selectedFile?.name || videoFileName,
      videoDurationSec,
      videoWidth,
      videoHeight,
      videoSizeMb,
    };

    let draft = pendingProject;
    try {
      if (!draft) {
        draft = await createDraftProject(config);
        if (mountedRef.current) {
          setPendingProject(draft);
        }
      }
      const { task } = await uploadAndReconstructProject(draft, selectedFile, config);
      if (mountedRef.current) {
        setPendingProject(null);
      }
      showToast('Walkthrough uploaded — reconstruction task queued!', 'success');
      navigate(`/progress/${task.id}`);
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Failed to upload video or start reconstruction.';
      if (mountedRef.current) {
        setUploadError(msg);
      }
      showToast(msg, 'error');
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-surface-warm text-on-surface">
      <AppHeader />

      <main className="w-full pt-20 flex-1">
        <div className="w-full max-w-7xl mx-auto px-6 py-10">
          <div className="max-w-3xl mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary-fixed/50 text-secondary border border-secondary-fixed-dim/60 text-xs font-semibold tracking-wider uppercase mb-3">
              <span className="material-symbols-outlined text-[15px]">auto_awesome</span>
              <span>Effortless Spatial Capture</span>
            </div>
            <h1 className="font-headline text-3xl sm:text-4xl md:text-5xl font-medium tracking-tight text-on-surface mb-3 leading-[1.18]">
              Turn Your Phone Video Into a 3D Room
            </h1>
            <p className="text-base sm:text-lg text-on-surface-variant leading-relaxed">
              Simply walk around your room recording a continuous smooth video. We automatically
              turn it into an editable, walkable 3D space with accurate real-world dimensions.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-7 flex flex-col gap-6">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleVideoFile(file);
                  e.target.value = '';
                }}
              />

              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleVideoFile(file);
                }}
                className={`relative transition-all duration-200 border-2 border-dashed rounded-2xl p-8 sm:p-10 flex flex-col items-center justify-center text-center cursor-pointer group shadow-sm hover:shadow ${
                  isDragging
                    ? 'border-primary bg-primary-container/30 scale-[1.01]'
                    : 'bg-surface-container-low/60 hover:bg-surface-container-low border-outline-variant hover:border-primary/70'
                }`}
              >
                <div className="w-16 h-16 rounded-2xl bg-surface-container flex items-center justify-center mb-4 text-primary group-hover:scale-105 transition-transform duration-200 shadow-sm border border-outline-variant/40">
                  <span className="material-symbols-outlined text-[32px]">video_camera_front</span>
                </div>
                <h2 className="font-headline text-xl sm:text-2xl font-medium text-on-surface mb-2">
                  Drop your room walkthrough video here
                </h2>
                <p className="text-sm text-on-surface-variant max-w-md mb-5 leading-normal">
                  Supports continuous iPhone or Android captures in{' '}
                  <span className="font-semibold text-on-surface">.mp4</span> or{' '}
                  <span className="font-semibold text-on-surface">.mov</span> formats (recommended
                  2–5 mins, automatically capped to 640–960px).
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    className="px-6 py-2.5 rounded-full bg-surface-container-lowest border border-outline-variant/70 text-on-surface font-medium text-sm hover:bg-surface-container hover:border-primary transition-all duration-150 shadow-sm flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[18px] text-primary">
                      folder_open
                    </span>
                    <span>Browse Video Files</span>
                  </button>
                  {selectedFile && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        resetToSampleVideo();
                      }}
                      className="px-4 py-2.5 rounded-full bg-surface-container text-on-surface-variant text-xs font-medium hover:text-on-surface transition-colors"
                    >
                      Reset to Sample Capture
                    </button>
                  )}
                </div>
              </div>

              <div className="bg-surface-container-low rounded-2xl p-5 sm:p-6 border border-outline-variant/60 shadow-sm flex flex-col gap-5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-[20px]">
                      movie_filter
                    </span>
                    <span className="text-xs font-semibold tracking-wider uppercase text-on-surface-variant">
                      Selected Capture
                    </span>
                  </div>
                  {hasVideoReady ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-tertiary-fixed text-tertiary-deep text-xs font-semibold border border-tertiary-fixed-dim">
                      <span className="w-1.5 h-1.5 rounded-full bg-tertiary-deep animate-pulse" />
                      <span>
                        {selectedFile ? 'Video selected' : 'Demo sample'} •{' '}
                        {videoDurationSec > 0 ? formatDuration(videoDurationSec) : 'Probing...'} •{' '}
                        {videoWidth > 0 ? `${videoWidth}×${videoHeight}` : 'Resolution pending'}
                      </span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container text-on-surface-variant text-xs font-medium border border-border-sand">
                      No file selected (required in Live Mode)
                    </span>
                  )}
                </div>

                <div className="relative w-full h-64 sm:h-72 rounded-xl overflow-hidden bg-surface-container-lowest border border-outline-variant/40 group">
                  {previewUrl ? (
                    <video
                      src={previewUrl}
                      controls
                      className="w-full h-full object-cover bg-black"
                    />
                  ) : demoMode ? (
                    <>
                      <SafeImage
                        src={STITCH_IMAGES.scanPreviewLiving}
                        alt="Sample walkthrough capture preview"
                        className="w-full h-full object-cover group-hover:scale-[1.01] transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent pointer-events-none" />
                    </>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 px-6 text-center bg-surface-container-low">
                      <span className="material-symbols-outlined text-4xl text-outline">
                        movie
                      </span>
                      <p className="text-sm font-medium text-on-surface">
                        Select a room walkthrough video above
                      </p>
                      <p className="text-xs text-on-surface-variant max-w-sm">
                        In Live Mode, real video bytes are uploaded and validated on the FastAPI
                        backend before reconstruction starts.
                      </p>
                    </div>
                  )}

                  {!previewUrl && demoMode && (
                    <>
                      <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-md px-2.5 py-1 rounded-full flex items-center gap-1.5 text-xs font-medium text-stone-800 shadow-sm">
                        <span className="material-symbols-outlined text-primary text-[14px]">
                          videocam
                        </span>
                        <span>Sample iPhone 15 Pro Walkthrough</span>
                      </div>
                      <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-4 text-white">
                        <div className="min-w-0">
                          <p className="font-medium text-base truncate text-white drop-shadow-sm">
                            {videoFileName}
                          </p>
                          <p className="text-xs text-white/80 drop-shadow-sm">
                            {videoSizeMb >= 1024
                              ? `${(videoSizeMb / 1024).toFixed(1)} GB`
                              : `${videoSizeMb} MB`}{' '}
                            · {formatDuration(videoDurationSec)} continuous loop · {videoWidth}×
                            {videoHeight}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/20 text-xs shrink-0 font-medium">
                          <span className="material-symbols-outlined text-amber-300 text-[15px]">
                            wb_sunny
                          </span>
                          <span>Good Natural Light</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="bg-surface-container-lowest rounded-xl p-4 border border-outline-variant/50 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-on-surface flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-primary">
                        checklist
                      </span>
                      Compute &amp; Capture Guardrails
                    </span>
                    <span className="text-[11px] font-medium text-tertiary-deep bg-tertiary-fixed/70 px-2.5 py-0.5 rounded-full">
                      ~{estimatedExtractedFrames} frames will be extracted
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                    <div className="p-2.5 rounded-lg bg-surface-container-low border border-border-sand">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-on-surface">Length (2–5 min)</span>
                        <span
                          className={`material-symbols-outlined text-[15px] ${
                            durationWithinIdeal ? 'text-tertiary-deep' : 'text-secondary'
                          }`}
                        >
                          {durationWithinIdeal ? 'check_circle' : 'info'}
                        </span>
                      </div>
                      <p className="text-[11px] text-on-surface-variant">
                        {videoDurationSec > 0 ? (
                          <>
                            Detected: {formatDuration(videoDurationSec)}{' '}
                            {durationWithinIdeal
                              ? '(Optimal)'
                              : demoMode
                                ? '(Demo override ready)'
                                : '(Outside 2–5 min W7 window)'}
                          </>
                        ) : (
                          'Waiting for video file'
                        )}
                      </p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-surface-container-low border border-border-sand">
                      <label className="font-semibold text-on-surface block mb-1" htmlFor="fps-select">
                        Frame Rate (1–4 fps)
                      </label>
                      <select
                        id="fps-select"
                        value={fps}
                        onChange={(e) => setFps(Number(e.target.value) as 1 | 2 | 3 | 4)}
                        className="w-full rounded-md border border-border-sand bg-white px-2 py-1 text-xs text-on-surface focus:outline-none focus:border-primary"
                      >
                        <option value={1}>1 fps (Slow pan)</option>
                        <option value={2}>2 fps (Recommended)</option>
                        <option value={3}>3 fps (Dense corners)</option>
                        <option value={4}>4 fps (Max overlap)</option>
                      </select>
                    </div>

                    <div className="p-2.5 rounded-lg bg-surface-container-low border border-border-sand">
                      <label className="font-semibold text-on-surface block mb-1" htmlFor="res-select">
                        Long Side Cap
                      </label>
                      <select
                        id="res-select"
                        value={maxLongSide}
                        onChange={(e) =>
                          setMaxLongSide(Number(e.target.value) as 640 | 768 | 960)
                        }
                        className="w-full rounded-md border border-border-sand bg-white px-2 py-1 text-xs text-on-surface focus:outline-none focus:border-primary"
                      >
                        <option value={640}>640 px (Fastest VRAM)</option>
                        <option value={768}>768 px (Balanced)</option>
                        <option value={960}>960 px (Max detail cap)</option>
                      </select>
                    </div>
                  </div>

                  <label className="flex items-center justify-between pt-1 cursor-pointer">
                    <span className="text-[11px] text-on-surface-variant">
                      Automatically drop blurry frames (Laplacian variance filter)
                    </span>
                    <input
                      type="checkbox"
                      checked={dropBlurryFrames}
                      onChange={(e) => setDropBlurryFrames(e.target.checked)}
                      className="w-4 h-4 rounded accent-primary cursor-pointer"
                    />
                  </label>
                </div>

                <div className="bg-surface-container rounded-xl p-4 sm:p-5 border border-outline-variant/40">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-secondary mb-3 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px]">tips_and_updates</span>
                    <span>Pro Tips for Pristine 3D Rooms</span>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="flex items-start gap-2.5 bg-surface-container-lowest/80 p-3 rounded-lg border border-outline-variant/30">
                      <span className="material-symbols-outlined text-primary text-[18px] mt-0.5">
                        curtains
                      </span>
                      <div className="text-xs">
                        <p className="font-semibold text-on-surface">Open curtains</p>
                        <p className="text-on-surface-variant text-[11px] leading-tight mt-0.5">
                          Diffuse daylight provides richer natural textures
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2.5 bg-surface-container-lowest/80 p-3 rounded-lg border border-outline-variant/30">
                      <span className="material-symbols-outlined text-primary text-[18px] mt-0.5">
                        directions_walk
                      </span>
                      <div className="text-xs">
                        <p className="font-semibold text-on-surface">Walk slowly</p>
                        <p className="text-on-surface-variant text-[11px] leading-tight mt-0.5">
                          Hold phone chest-high in one calm, continuous loop
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2.5 bg-surface-container-lowest/80 p-3 rounded-lg border border-outline-variant/30">
                      <span className="material-symbols-outlined text-primary text-[18px] mt-0.5">
                        chair
                      </span>
                      <div className="text-xs">
                        <p className="font-semibold text-on-surface">Capture corners</p>
                        <p className="text-on-surface-variant text-[11px] leading-tight mt-0.5">
                          Tilt gently to include furniture edges &amp; baseboards
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Room Setup & Quality */}
            <div className="lg:col-span-5 bg-surface-container-low rounded-2xl p-6 sm:p-8 border border-outline-variant/60 shadow-sm flex flex-col gap-6">
              <div className="border-b border-outline-variant/40 pb-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-secondary">
                  Step 2 of 2
                </span>
                <h2 className="font-headline text-2xl font-medium text-on-surface mt-1">
                  Room Setup &amp; Quality
                </h2>
                <p className="text-xs text-on-surface-variant mt-1">
                  Customize how your space is prepared for interior planning.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  className="text-sm font-semibold text-on-surface flex items-center justify-between"
                  htmlFor="project-name"
                >
                  <span>Name your space</span>
                  <span className="text-xs text-on-surface-variant font-normal">
                    Visible on floor plans
                  </span>
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined text-[18px] text-outline absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
                    home
                  </span>
                  <input
                    id="project-name"
                    type="text"
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    className="w-full bg-surface-container-lowest text-on-surface text-sm font-medium pl-10 pr-4 py-3 rounded-xl border border-outline-variant/70 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span id="room-category-label" className="text-sm font-semibold text-on-surface">
                  Room Category
                </span>
                <div
                  role="group"
                  aria-labelledby="room-category-label"
                  className="grid grid-cols-3 gap-2"
                >
                  {[
                    { id: 'living' as const, label: 'Living Room' },
                    { id: 'kitchen' as const, label: 'Kitchen' },
                    { id: 'bedroom' as const, label: 'Bedroom' },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategory(cat.id)}
                      className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all ${
                        category === cat.id
                          ? 'bg-primary text-white border-primary shadow-sm'
                          : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant/60 hover:border-primary/40'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-on-surface">
                    Quality / Detail Level
                  </span>
                  <span className="text-xs font-medium text-secondary">
                    {qualityMode === 'atelier'
                      ? 'Ultra-clear daylight & fabrics'
                      : 'Quick layout preview'}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setQualityMode('atelier')}
                    className={`group relative flex items-start p-3.5 rounded-xl text-left transition-all duration-150 ${
                      qualityMode === 'atelier'
                        ? 'border-2 border-primary bg-primary/5'
                        : 'border border-outline-variant bg-surface-container-lowest hover:border-outline'
                    }`}
                  >
                    <div
                      className={`flex items-center justify-center w-5 h-5 rounded-full border-2 mr-3 mt-0.5 shrink-0 ${
                        qualityMode === 'atelier'
                          ? 'border-primary bg-primary text-on-primary'
                          : 'border-outline-variant'
                      }`}
                    >
                      {qualityMode === 'atelier' && (
                        <span className="material-symbols-outlined text-[14px]">check</span>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm font-semibold text-on-surface font-headline tracking-wide">
                          Atelier Studio
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-secondary-fixed text-on-secondary-fixed px-2 py-0.5 rounded-full">
                          Recommended
                        </span>
                      </div>
                      <p className="text-xs text-on-surface-variant">
                        Ultra Photoreal 3D (15k–30k 3DGS iterations) with true-to-life reflections,
                        wallpaper, and fabric grain (~4 mins).
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setQualityMode('sketch')}
                    className={`group relative flex items-start p-3.5 rounded-xl text-left transition-all duration-150 ${
                      qualityMode === 'sketch'
                        ? 'border-2 border-primary bg-primary/5'
                        : 'border border-outline-variant bg-surface-container-lowest hover:border-outline'
                    }`}
                  >
                    <div
                      className={`flex items-center justify-center w-5 h-5 rounded-full border-2 mr-3 mt-0.5 shrink-0 ${
                        qualityMode === 'sketch'
                          ? 'border-primary bg-primary text-on-primary'
                          : 'border-outline-variant'
                      }`}
                    >
                      {qualityMode === 'sketch' && (
                        <span className="material-symbols-outlined text-[14px]">check</span>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm font-semibold text-on-surface font-headline tracking-wide">
                          Fast Sketch
                        </span>
                        <span className="text-[11px] font-medium text-on-surface-variant">
                          ~90 seconds
                        </span>
                      </div>
                      <p className="text-xs text-on-surface-variant">
                        Quick spatial preview (7k iterations). Perfect for testing scale, layout
                        arrangements, and door clearances.
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              <div className="bg-surface-container rounded-xl p-4 border border-outline-variant/40 flex items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-secondary text-[22px] mt-0.5">
                    straighten
                  </span>
                  <div>
                    <span className="text-sm font-semibold text-on-surface block">
                      Automatic Room Dimensions
                    </span>
                    <span className="text-xs text-on-surface-variant leading-snug block mt-0.5">
                      Detects ceilings, wall lengths, and standard door heights (Metric &amp;
                      Imperial).
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  aria-pressed={autoDimensions}
                  onClick={() => setAutoDimensions((v) => !v)}
                  className={`w-12 h-7 rounded-full p-0.5 transition-colors flex items-center shrink-0 cursor-pointer shadow-inner ${
                    autoDimensions ? 'bg-primary justify-end' : 'bg-outline-variant justify-start'
                  }`}
                >
                  <span className="w-6 h-6 rounded-full bg-white shadow-sm" />
                </button>
              </div>

              {uploadError && (
                <div
                  role="alert"
                  className="rounded-xl bg-error-container border border-error/40 text-on-error-container p-4 text-xs space-y-2"
                >
                  <div className="flex items-start gap-2">
                    <span className="material-symbols-outlined text-error text-[18px] mt-0.5">
                      error
                    </span>
                    <div className="flex-1">
                      <p className="font-semibold">
                        Upload / Launch Failed
                        {pendingProject ? ` (Draft ${pendingProject.id} preserved)` : ''}
                      </p>
                      <p className="mt-0.5 leading-relaxed">{uploadError}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void handleSubmit()}
                      className="px-3.5 py-1.5 rounded-full bg-error text-white font-semibold hover:opacity-90 disabled:opacity-60"
                    >
                      {submitting ? 'Retrying...' : 'Retry Upload on Same Project'}
                    </button>
                    {pendingProject && (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => {
                          setPendingProject(null);
                          setUploadError(null);
                        }}
                        className="px-3 py-1.5 rounded-full bg-surface-container text-on-surface font-medium"
                      >
                        Discard Draft
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="pt-2 flex flex-col gap-2.5">
                <button
                  type="button"
                  disabled={submitting || (!demoMode && !selectedFile)}
                  onClick={() => void handleSubmit()}
                  className="w-full py-4 px-6 rounded-full bg-primary text-on-primary font-headline text-lg font-medium flex items-center justify-center gap-2 hover:bg-primary-hover active:scale-[0.99] transition-all shadow-md hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <span>
                    {submitting
                      ? 'Uploading & Queueing 3D Space...'
                      : pendingProject
                        ? 'Retry Upload & Queue 3D Room'
                        : 'Generate My 3D Room'}
                  </span>
                  <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
                </button>
                <p className="text-center text-[12px] text-on-surface-variant flex items-center justify-center gap-1.5">
                  <span className="material-symbols-outlined text-[15px] text-secondary">
                    verified_user
                  </span>
                  <span>
                    Your captures remain private and encrypted on secure atelier servers.
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      <AppFooter />
    </div>
  );
};
