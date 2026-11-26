import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  getApiBaseUrl,
  getOrCreateSessionId,
  safeStorageGet,
  STORAGE_KEYS,
} from '../../services/api';
import { MaskPoint, SampledFrame } from '../../types';
import { AtelierModal } from '../modals/InfoModals';

// ---------------------------------------------------------------------------
// Authenticated Artifact Fetch Cache & Pixel Coordinate Helpers
// ---------------------------------------------------------------------------

const artifactBlobCache = new Map<string, string>();

export function isProtectedArtifactUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.startsWith('data:') || url.startsWith('blob:')) return false;
  const baseUrl = getApiBaseUrl();
  if (url.includes('/artifacts/')) return true;
  if (baseUrl && url.startsWith(baseUrl)) return true;
  return false;
}

export async function fetchAuthorizedArtifactBlobUrl(url: string): Promise<string> {
  const cached = artifactBlobCache.get(url);
  if (cached) return cached;

  const headers = new Headers();
  headers.set('X-Session-Id', getOrCreateSessionId());
  const token = safeStorageGet(STORAGE_KEYS.token);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Artifact fetch failed (${res.status})`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  artifactBlobCache.set(url, objectUrl);
  return objectUrl;
}

export interface RenderedImageBox {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export function computeObjectContainBox(
  containerWidth: number,
  containerHeight: number,
  naturalWidth: number,
  naturalHeight: number
): RenderedImageBox {
  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
    return { width: 0, height: 0, offsetX: 0, offsetY: 0 };
  }
  const containerAspect = containerWidth / containerHeight;
  const imageAspect = naturalWidth / naturalHeight;

  if (containerAspect > imageAspect) {
    const height = containerHeight;
    const width = height * imageAspect;
    return {
      width,
      height,
      offsetX: (containerWidth - width) / 2,
      offsetY: 0,
    };
  }
  const width = containerWidth;
  const height = width / imageAspect;
  return {
    width,
    height,
    offsetX: 0,
    offsetY: (containerHeight - height) / 2,
  };
}

export function mapClientClickToImagePixel(
  clientX: number,
  clientY: number,
  containerRect: DOMRect,
  naturalWidth: number,
  naturalHeight: number
): { xPx: number; yPx: number } | null {
  if (
    containerRect.width <= 0 ||
    containerRect.height <= 0 ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
    return null;
  }
  const box = computeObjectContainBox(
    containerRect.width,
    containerRect.height,
    naturalWidth,
    naturalHeight
  );
  if (box.width <= 0 || box.height <= 0) return null;

  const relX = clientX - containerRect.left - box.offsetX;
  const relY = clientY - containerRect.top - box.offsetY;

  // Ignore clicks in letterbox/pillarbox bars outside the actual image area
  if (relX < -1 || relX > box.width + 1 || relY < -1 || relY > box.height + 1) {
    return null;
  }

  const u = Math.max(0, Math.min(1, relX / box.width));
  const v = Math.max(0, Math.min(1, relY / box.height));

  const xPx = Math.min(naturalWidth - 1, Math.max(0, Math.round(u * (naturalWidth - 1))));
  const yPx = Math.min(naturalHeight - 1, Math.max(0, Math.round(v * (naturalHeight - 1))));

  return { xPx, yPx };
}

// ---------------------------------------------------------------------------
// Authenticated Image & Binary Mask Overlay Components
// ---------------------------------------------------------------------------

interface ArtifactImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src?: string;
  fallbackLabel?: string;
  onNaturalDimensions?: (width: number, height: number) => void;
}

export const ArtifactImage: React.FC<ArtifactImageProps> = ({
  src,
  alt,
  className = '',
  fallbackLabel,
  onNaturalDimensions,
  onLoad,
  ...rest
}) => {
  const [resolvedSrc, setResolvedSrc] = useState<string>('');
  const [failed, setFailed] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    if (!src) {
      setResolvedSrc('');
      return;
    }
    if (!isProtectedArtifactUrl(src)) {
      setResolvedSrc(src);
      return;
    }

    fetchAuthorizedArtifactBlobUrl(src)
      .then((objUrl) => {
        if (active) setResolvedSrc(objUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [src]);

  if (!src || failed || !resolvedSrc) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-surface-container-low via-surface-container to-primary-container/40 text-on-surface-variant p-3 text-center ${className}`}
        role="img"
        aria-label={alt || fallbackLabel || 'Atelier Spatial Frame'}
      >
        <span className="material-symbols-outlined text-primary/70 text-[24px] mb-1">
          {!failed && src ? 'hourglass_top' : 'view_in_ar'}
        </span>
        <span className="text-[10px] font-medium text-on-surface-variant/80 line-clamp-2">
          {!failed && src ? 'Loading frame...' : fallbackLabel || alt || 'Frame unavailable'}
        </span>
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      draggable={false}
      onError={() => setFailed(true)}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          onNaturalDimensions?.(img.naturalWidth, img.naturalHeight);
        }
        onLoad?.(e);
      }}
      {...rest}
    />
  );
};

interface MaskOverlayCanvasProps {
  maskUrl: string | null | undefined;
  className?: string;
}

export const MaskOverlayCanvas: React.FC<MaskOverlayCanvasProps> = ({
  maskUrl,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasMask, setHasMask] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    const canvas = canvasRef.current;
    if (!maskUrl || !canvas) {
      setHasMask(false);
      return;
    }

    const loadAndTint = async () => {
      try {
        const usableUrl = isProtectedArtifactUrl(maskUrl)
          ? await fetchAuthorizedArtifactBlobUrl(maskUrl)
          : maskUrl;
        if (!active) return;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (!active || !canvasRef.current) return;
          const w = img.naturalWidth;
          const h = img.naturalHeight;
          if (w <= 0 || h <= 0) {
            setHasMask(false);
            return;
          }
          const c = canvasRef.current;
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d');
          if (!ctx) return;
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);

          const imgData = ctx.getImageData(0, 0, w, h);
          const data = imgData.data;
          // Preserve binary mask geometry with high-contrast terracotta fill + bright edge outline
          const binary = new Uint8Array(w * h);
          let fgCount = 0;
          for (let i = 0, p = 0; i < data.length; i += 4, p++) {
            const val = Math.max(data[i], data[i + 1], data[i + 2]);
            if (val > 127 && data[i + 3] > 0) {
              binary[p] = 1;
              fgCount++;
            }
          }

          if (fgCount === 0) {
            ctx.clearRect(0, 0, w, h);
            setHasMask(false);
            return;
          }

          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const p = y * w + x;
              const idx = p * 4;
              if (binary[p] === 0) {
                data[idx] = 0;
                data[idx + 1] = 0;
                data[idx + 2] = 0;
                data[idx + 3] = 0;
                continue;
              }
              const isEdge =
                x === 0 ||
                x === w - 1 ||
                y === 0 ||
                y === h - 1 ||
                binary[p - 1] === 0 ||
                binary[p + 1] === 0 ||
                binary[p - w] === 0 ||
                binary[p + w] === 0;
              if (isEdge) {
                data[idx] = 245;
                data[idx + 1] = 122;
                data[idx + 2] = 72;
                data[idx + 3] = 245;
              } else {
                data[idx] = 194;
                data[idx + 1] = 97;
                data[idx + 2] = 59;
                data[idx + 3] = 112;
              }
            }
          }
          ctx.putImageData(imgData, 0, 0);
          setHasMask(true);
        };
        img.onerror = () => {
          if (active) setHasMask(false);
        };
        img.src = usableUrl;
      } catch {
        if (active) setHasMask(false);
      }
    };

    void loadAndTint();
    return () => {
      active = false;
    };
  }, [maskUrl]);

  return (
    <canvas
      ref={canvasRef}
      className={`${className} ${hasMask ? 'opacity-100' : 'opacity-0'}`}
    />
  );
};

// ---------------------------------------------------------------------------
// Frame Mask Tracking & Review Grid Modal
// ---------------------------------------------------------------------------

interface FrameMaskGridModalProps {
  open: boolean;
  onClose: () => void;
  frames: SampledFrame[];
  activeFrameId: string;
  perFramePoints: Record<string, MaskPoint[]>;
  canEdit?: boolean;
  savingReview?: boolean;
  resegmentingFrameId?: string | null;
  onToggleFrameMark: (frameId: string) => void;
  onSelectReferenceFrame: (frameId: string) => void;
  onSelectAllDetected: () => void;
  onPlaceHintAndResegment: (frameId: string, points: MaskPoint[]) => Promise<void>;
  onSaveReview: () => Promise<void>;
}

export const FrameMaskGridModal: React.FC<FrameMaskGridModalProps> = ({
  open,
  onClose,
  frames,
  activeFrameId,
  perFramePoints,
  canEdit = true,
  savingReview = false,
  resegmentingFrameId = null,
  onToggleFrameMark,
  onSelectReferenceFrame,
  onSelectAllDetected,
  onPlaceHintAndResegment,
  onSaveReview,
}) => {
  const [hintFrameId, setHintFrameId] = useState<string | null>(null);
  const [hintMode, setHintMode] = useState<'positive' | 'negative'>('positive');
  const [filterMode, setFilterMode] = useState<'all' | 'marked' | 'unmarked'>('all');
  const [hintNaturalSize, setHintNaturalSize] = useState<{ w: number; h: number }>({
    w: 960,
    h: 540,
  });
  const hintContainerRef = useRef<HTMLDivElement | null>(null);
  const [hintBox, setHintBox] = useState<RenderedImageBox>({
    width: 0,
    height: 0,
    offsetX: 0,
    offsetY: 0,
  });

  const hintFrame = useMemo(
    () => frames.find((f) => f.id === hintFrameId) || null,
    [frames, hintFrameId]
  );

  useEffect(() => {
    if (!open) {
      setHintFrameId(null);
    }
  }, [open]);

  useEffect(() => {
    if (!hintFrame) return;
    setHintNaturalSize({
      w: hintFrame.width || 960,
      h: hintFrame.height || 540,
    });
  }, [hintFrame]);

  useEffect(() => {
    const el = hintContainerRef.current;
    if (!el || !hintFrame) return;

    const updateBox = () => {
      setHintBox(
        computeObjectContainBox(
          el.clientWidth,
          el.clientHeight,
          hintNaturalSize.w,
          hintNaturalSize.h
        )
      );
    };
    updateBox();

    if (typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(updateBox);
    obs.observe(el);
    return () => obs.disconnect();
  }, [hintFrame, hintNaturalSize]);

  const registeredFrames = useMemo(
    () => frames.filter((f) => f.registered !== false),
    [frames]
  );
  const markedCount = registeredFrames.filter((f) => f.userMarked).length;

  const filteredFrames = useMemo(() => {
    if (filterMode === 'marked') return frames.filter((f) => f.userMarked);
    if (filterMode === 'unmarked') return frames.filter((f) => !f.userMarked);
    return frames;
  }, [frames, filterMode]);

  const handleHintCanvasClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canEdit || !hintFrame || resegmentingFrameId === hintFrame.id) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mapped = mapClientClickToImagePixel(
      e.clientX,
      e.clientY,
      rect,
      hintNaturalSize.w,
      hintNaturalSize.h
    );
    if (!mapped) return;

    const existing = perFramePoints[hintFrame.id] ?? [];
    const nextPt: MaskPoint = {
      id: `pt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      x: (mapped.xPx / Math.max(1, hintNaturalSize.w - 1)) * 100,
      y: (mapped.yPx / Math.max(1, hintNaturalSize.h - 1)) * 100,
      xPx: mapped.xPx,
      yPx: mapped.yPx,
      type: hintMode,
      frameId: hintFrame.id,
    };
    await onPlaceHintAndResegment(hintFrame.id, [...existing, nextPt]);
  };

  return (
    <AtelierModal
      open={open}
      onClose={onClose}
      title="Frame Mask Review & Fallback Grid"
      subtitle="Tick/untick tracked frames or place a click hint on missed frames before diffusion"
      icon="grid_view"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs bg-surface-container-low p-3 rounded-xl border border-border-sand">
          <span className="text-on-surface-muted">
            <strong className="text-on-surface">{markedCount}</strong> of{' '}
            {registeredFrames.length} registered frames selected for diffusion
          </span>
          <div className="flex items-center gap-2">
            {canEdit && (
              <button
                type="button"
                onClick={onSelectAllDetected}
                className="text-primary-deep font-semibold hover:underline"
              >
                Auto-select detected
              </button>
            )}
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 text-[11px]">
          {(['all', 'marked', 'unmarked'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setFilterMode(mode)}
              className={`px-3 py-1 rounded-full border font-medium capitalize transition-colors ${
                filterMode === mode
                  ? 'bg-primary text-white border-primary'
                  : 'bg-surface-container-low text-on-surface-muted border-border-sand hover:text-on-surface'
              }`}
            >
              {mode === 'all'
                ? `All (${frames.length})`
                : mode === 'marked'
                  ? `Included (${markedCount})`
                  : `Excluded (${frames.length - markedCount})`}
            </button>
          ))}
        </div>

        {/* Inline Hint Placement & Re-segmentation Panel */}
        {hintFrame && (
          <div className="p-3 rounded-2xl bg-surface-container-low border border-primary/40 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-on-surface">
                Hint Placement: Frame #{hintFrame.index} ({hintNaturalSize.w}×{hintNaturalSize.h}px)
              </div>
              <button
                type="button"
                onClick={() => setHintFrameId(null)}
                className="text-[11px] font-semibold text-on-surface-muted hover:text-on-surface"
              >
                Back to Grid
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setHintMode('positive')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                    hintMode === 'positive'
                      ? 'bg-primary-deep text-white'
                      : 'bg-white border border-border-sand text-on-surface'
                  }`}
                >
                  + Include Object
                </button>
                <button
                  type="button"
                  onClick={() => setHintMode('negative')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                    hintMode === 'negative'
                      ? 'bg-error text-white'
                      : 'bg-white border border-border-sand text-on-surface'
                  }`}
                >
                  - Exclude Area
                </button>
              </div>
              {(perFramePoints[hintFrame.id]?.length ?? 0) > 0 && (
                <button
                  type="button"
                  disabled={resegmentingFrameId === hintFrame.id}
                  onClick={() => {
                    const pts = perFramePoints[hintFrame.id] ?? [];
                    void onPlaceHintAndResegment(hintFrame.id, pts.slice(0, -1));
                  }}
                  className="text-[11px] font-semibold text-primary-deep hover:underline disabled:opacity-50"
                >
                  Undo last hint
                </button>
              )}
            </div>

            <div
              ref={hintContainerRef}
              onClick={(e) => void handleHintCanvasClick(e)}
              className="relative w-full h-56 rounded-xl overflow-hidden bg-stone-950 cursor-crosshair select-none"
            >
              <ArtifactImage
                src={hintFrame.imageUrl}
                alt={`Hint frame ${hintFrame.index}`}
                className="w-full h-full object-contain"
                onNaturalDimensions={(w, h) => setHintNaturalSize({ w, h })}
              />
              {hintBox.width > 0 && hintBox.height > 0 && (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: `${hintBox.offsetX}px`,
                    top: `${hintBox.offsetY}px`,
                    width: `${hintBox.width}px`,
                    height: `${hintBox.height}px`,
                  }}
                >
                  {hintFrame.maskUrl ? (
                    <MaskOverlayCanvas
                      maskUrl={hintFrame.maskUrl}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    hintFrame.userMarked &&
                    hintFrame.maskBox.w > 0 && (
                      <div
                        className="absolute border-2 border-primary bg-primary/25 rounded-lg"
                        style={{
                          left: `${hintFrame.maskBox.x}%`,
                          top: `${hintFrame.maskBox.y}%`,
                          width: `${hintFrame.maskBox.w}%`,
                          height: `${hintFrame.maskBox.h}%`,
                        }}
                      />
                    )
                  )}
                  {(perFramePoints[hintFrame.id] ?? []).map((pt) => {
                    const leftPct =
                      pt.xPx !== undefined
                        ? (pt.xPx / Math.max(1, hintNaturalSize.w - 1)) * 100
                        : pt.x;
                    const topPct =
                      pt.yPx !== undefined
                        ? (pt.yPx / Math.max(1, hintNaturalSize.h - 1)) * 100
                        : pt.y;
                    return (
                      <div
                        key={pt.id}
                        style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                        className={`absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow border flex items-center justify-center ${
                          pt.type === 'positive' ? 'border-primary' : 'border-error'
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${
                            pt.type === 'positive' ? 'bg-primary' : 'bg-error'
                          }`}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
              {resegmentingFrameId === hintFrame.id && (
                <div className="absolute inset-0 bg-black/45 flex items-center justify-center text-white text-xs font-semibold">
                  Re-running segmentation...
                </div>
              )}
            </div>
            <p className="text-[11px] text-on-surface-muted">
              Click directly on the object in the undistorted frame to place a pixel hint and
              regenerate its mask.
            </p>
          </div>
        )}

        {/* Frame Grid */}
        <div className="grid grid-cols-2 gap-3">
          {filteredFrames.map((frame) => {
            const isActiveRef = frame.id === activeFrameId;
            const isRegistered = frame.registered !== false;
            const framePins = perFramePoints[frame.id]?.length ?? 0;
            return (
              <div
                key={frame.id}
                className={`rounded-xl overflow-hidden border transition-all bg-surface-container-lowest ${
                  !isRegistered
                    ? 'border-border-sand opacity-60'
                    : frame.userMarked
                      ? 'border-primary ring-1 ring-primary/30 shadow-sm'
                      : 'border-border-sand opacity-80'
                }`}
              >
                <div
                  className={`relative h-28 bg-stone-950 ${
                    isRegistered && canEdit ? 'cursor-pointer' : 'cursor-default'
                  }`}
                  onClick={() => {
                    if (isRegistered && canEdit) onToggleFrameMark(frame.id);
                  }}
                >
                  <ArtifactImage
                    src={frame.imageUrl}
                    alt={`Sampled frame ${frame.index}`}
                    className="w-full h-full object-contain"
                  />

                  {isRegistered && frame.maskUrl ? (
                    <MaskOverlayCanvas
                      maskUrl={frame.maskUrl}
                      className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                    />
                  ) : (
                    isRegistered &&
                    frame.userMarked &&
                    frame.maskBox.w > 0 && (
                      <div
                        className="absolute border-2 border-primary bg-primary/25 rounded-lg pointer-events-none transition-all"
                        style={{
                          left: `${frame.maskBox.x}%`,
                          top: `${frame.maskBox.y}%`,
                          width: `${frame.maskBox.w}%`,
                          height: `${frame.maskBox.h}%`,
                        }}
                      />
                    )
                  )}

                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/70 text-white text-[10px] font-medium">
                    #{frame.index} • {frame.timestampLabel}
                  </div>

                  {!isRegistered ? (
                    <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full bg-error/90 text-white text-[9px] font-semibold">
                      Dropped: {frame.droppedReason || 'unregistered'}
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (canEdit) onToggleFrameMark(frame.id);
                      }}
                      aria-label={frame.userMarked ? 'Unmark frame' : 'Mark frame'}
                      className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center shadow disabled:opacity-60 ${
                        frame.userMarked
                          ? 'bg-primary text-white'
                          : 'bg-white/90 text-outline border border-border-sand'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[15px]">
                        {frame.userMarked ? 'check' : 'add'}
                      </span>
                    </button>
                  )}
                </div>

                <div className="px-2.5 py-2 flex items-center justify-between gap-1 text-[11px] bg-surface-container-low/60">
                  <span className="text-on-surface-muted truncate">
                    {isRegistered ? (
                      <>
                        IoU: <strong>{Math.round(frame.confidence * 100)}%</strong>
                        {framePins > 0 ? ` • ${framePins}p` : ''}
                      </>
                    ) : (
                      'Unregistered'
                    )}
                  </span>
                  {isRegistered && (
                    <div className="flex items-center gap-2 shrink-0">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setHintFrameId(frame.id)}
                          className="font-semibold text-secondary hover:underline"
                        >
                          Hint
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          onSelectReferenceFrame(frame.id);
                          onClose();
                        }}
                        className={`font-semibold ${
                          isActiveRef ? 'text-tertiary-deep' : 'text-primary-deep hover:underline'
                        }`}
                      >
                        {isActiveRef ? 'Ref ✓' : 'Use Ref'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border-sand">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-full bg-surface-container text-on-surface text-xs font-medium hover:bg-surface-container-high"
          >
            Close
          </button>
          <button
            type="button"
            disabled={!canEdit || savingReview}
            onClick={() => void onSaveReview()}
            className="px-5 py-2 rounded-full bg-primary text-white text-xs font-semibold hover:bg-primary-hover disabled:opacity-50"
          >
            {savingReview
              ? 'Saving Review...'
              : canEdit
                ? `Save Reviewed Masks (${markedCount} Frames)`
                : 'Read-Only Mode'}
          </button>
        </div>
      </div>
    </AtelierModal>
  );
};
