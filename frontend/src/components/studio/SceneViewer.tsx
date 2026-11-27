import React, { useRef, useState } from 'react';
import type { SceneData } from '../../types';
import { SplatRoomViewport } from './SplatRoomViewport';
import type {
  ArtifactStatusInfo,
  CameraControlMode,
  MovementDirection,
  SplatViewportHandle,
  ViewportRenderMode,
} from './SplatRoomViewport';

export const SceneViewer: React.FC<{ scene: SceneData }> = ({ scene }) => {
  const viewport = useRef<SplatViewportHandle>(null);
  const [mode, setMode] = useState<CameraControlMode>('fly');
  const [renderMode, setRenderMode] = useState<ViewportRenderMode>('splat');
  const [speed, setSpeed] = useState(1.5);
  const [fps, setFps] = useState(0);
  const [status, setStatus] = useState<ArtifactStatusInfo>({ mode: 'loading' });
  const button =
    'rounded-full border border-border-sand px-4 py-2 text-xs font-semibold transition-colors hover:bg-surface-container';
  const moves: { direction: MovementDirection; icon: string; label: string }[] =
    [
      { direction: 'forward', icon: 'arrow_upward', label: 'Move forward' },
      { direction: 'left', icon: 'arrow_back', label: 'Move left' },
      { direction: 'backward', icon: 'arrow_downward', label: 'Move backward' },
      { direction: 'right', icon: 'arrow_forward', label: 'Move right' },
      { direction: 'up', icon: 'vertical_align_top', label: 'Move up' },
      { direction: 'down', icon: 'vertical_align_bottom', label: 'Move down' },
    ];
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-border-sand bg-surface-container-lowest shadow-soft">
      <div
        className="flex flex-wrap items-center gap-2 border-b border-border-sand p-3 sm:px-5 text-on-surface"
        role="toolbar"
        aria-label="Scene navigation"
      >
        <div className="flex rounded-full bg-surface-container p-1">
          {(['orbit', 'fly'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold ${mode === value ? 'bg-white shadow-sm text-primary' : 'text-on-surface-variant'}`}
            >
              {value === 'orbit' ? 'Orbit' : 'Walk'}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={button}
          onClick={() => viewport.current?.resetCamera()}
        >
          <span className="material-symbols-outlined align-middle text-[16px] mr-1">
            restart_alt
          </span>
          Reset view
        </button>
        <button
          type="button"
          className={button}
          onClick={() =>
            setRenderMode((value) =>
              value === 'splat' ? 'pointcloud' : 'splat'
            )
          }
        >
          {renderMode === 'splat' ? 'Show point cloud' : 'Show 3D splat'}
        </button>
        <span
          className="ml-auto text-[11px] text-on-surface-variant"
          aria-live="polite"
        >
          {status.mode === 'loading'
            ? 'Loading…'
            : status.mode === 'error'
              ? 'Scene unavailable'
              : `${(status.gaussianCount || 0).toLocaleString()} ${status.mode === 'splat' ? 'Gaussians' : 'points'}`}
          {fps > 0 && status.mode !== 'error' && status.mode !== 'loading'
            ? ` · ${fps} FPS`
            : ''}
        </span>
      </div>
      <div className="relative flex-1 min-h-[280px]">
        <SplatRoomViewport
          key={scene.runId || scene.projectId}
          ref={viewport}
          cameraMode={mode}
          flySpeed={speed}
          renderMode={renderMode}
          splatUrl={scene.splatUrl}
          pointCloudUrl={scene.pointCloudUrl}
          viewerTransform={scene.viewerTransform}
          initialPose={scene.cameraPoses[0]}
          onFpsUpdate={setFps}
          onArtifactStatusChange={setStatus}
        />
        {mode === 'fly' &&
          status.mode !== 'error' &&
          status.mode !== 'loading' && (
            <div
              className="absolute bottom-4 right-4 grid grid-cols-3 gap-1 rounded-2xl border border-white/30 bg-black/45 p-2 backdrop-blur-sm"
              role="group"
              aria-label="Touch movement controls"
            >
              {moves.map((move) => (
                <button
                  key={move.direction}
                  type="button"
                  aria-label={move.label}
                  className="h-11 w-11 touch-none select-none rounded-xl bg-white/95 text-on-surface active:bg-primary active:text-white"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    viewport.current?.focus();
                    viewport.current?.setMovement(move.direction, true);
                  }}
                  onPointerUp={() =>
                    viewport.current?.setMovement(move.direction, false)
                  }
                  onPointerCancel={() =>
                    viewport.current?.setMovement(move.direction, false)
                  }
                  onLostPointerCapture={() =>
                    viewport.current?.setMovement(move.direction, false)
                  }
                  onKeyDown={(event) => {
                    if (event.code === 'Space' || event.code === 'Enter') {
                      event.preventDefault();
                      viewport.current?.setMovement(move.direction, true);
                    }
                  }}
                  onKeyUp={() =>
                    viewport.current?.setMovement(move.direction, false)
                  }
                  onBlur={() =>
                    viewport.current?.setMovement(move.direction, false)
                  }
                >
                  <span className="material-symbols-outlined text-[20px]">
                    {move.icon}
                  </span>
                </button>
              ))}
            </div>
          )}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border-sand px-5 py-3 text-xs text-on-surface-variant">
        <p className="flex-1 min-w-[220px]">
          {mode === 'orbit'
            ? 'Drag to orbit · scroll or pinch to zoom · right-drag to pan.'
            : 'Click the scene, then use W A S D or arrow keys to move. Drag to look · Q / E down / up.'}
        </p>
        {mode === 'fly' && (
          <label className="flex items-center gap-2">
            Speed
            <input
              aria-label="Walk speed"
              className="w-24 accent-primary"
              type="range"
              min="0.25"
              max="4"
              step="0.25"
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
            />
          </label>
        )}
        {scene.cameraPoses.slice(0, 4).map((pose, index) => (
          <button
            key={pose.id}
            type="button"
            className="rounded-full bg-surface-container px-3 py-1 hover:text-primary"
            onClick={() => viewport.current?.loadCameraPose(pose)}
          >
            View {index + 1}
          </button>
        ))}
      </div>
    </section>
  );
};
