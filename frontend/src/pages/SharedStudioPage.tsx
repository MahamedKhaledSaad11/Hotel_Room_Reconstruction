import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  CameraControlMode,
  SplatRoomViewport,
  SplatViewportHandle,
  ViewportRenderMode,
} from '../components/studio/SplatRoomViewport';
import { api } from '../services/api';
import { SharedSceneData } from '../types';

export const SharedStudioPage: React.FC = () => {
  const { shareToken } = useParams<{ shareToken: string }>();
  const viewportRef = useRef<SplatViewportHandle | null>(null);

  const [scene, setScene] = useState<SharedSceneData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cameraMode, setCameraMode] = useState<CameraControlMode>('orbit');
  const [flySpeed, setFlySpeed] = useState<number>(1.5);
  const [renderMode, setRenderMode] = useState<ViewportRenderMode>('splat');
  const [fps, setFps] = useState<number>(60);
  const [pathPlaying, setPathPlaying] = useState<boolean>(false);

  useEffect(() => {
    if (!shareToken) {
      setError('Missing share token.');
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    void api
      .getSharedScene(shareToken)
      .then((data) => {
        if (!active) return;
        setScene(data);
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof Error && err.message
            ? err.message
            : 'This share link is invalid, expired, or has been revoked.'
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [shareToken]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface text-on-surface px-6 text-center">
        <span className="material-symbols-outlined text-4xl text-primary animate-spin mb-3">
          progress_activity
        </span>
        <h1 className="font-headline text-2xl">Opening Shared 3D Room...</h1>
        <p className="text-xs text-on-surface-variant mt-1">
          Loading read-only Gaussian Splat scene
        </p>
      </div>
    );
  }

  if (error || !scene) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface text-on-surface px-6 text-center">
        <div className="max-w-md w-full rounded-2xl bg-surface-container-lowest border border-border-sand shadow-lg p-8 space-y-4">
          <div className="w-12 h-12 mx-auto rounded-full bg-error-container text-error flex items-center justify-center">
            <span className="material-symbols-outlined text-[26px]">link_off</span>
          </div>
          <h1 className="font-headline text-2xl text-on-surface">
            Shared Walkthrough Unavailable
          </h1>
          <p className="text-xs text-on-surface-variant leading-relaxed">
            {error || 'This link is invalid, expired, or revoked by the room owner.'}
          </p>
          <div className="pt-2">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-on-primary text-xs font-semibold hover:bg-primary-hover transition-colors"
            >
              <span>Sign In to AuraSpace</span>
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const activeVersion =
    scene.activeVersion && scene.versions?.[scene.activeVersion]
      ? scene.versions[scene.activeVersion]
      : undefined;

  return (
    <div className="h-screen w-screen flex flex-col bg-inverse-surface text-surface overflow-hidden">
      <header className="h-16 px-4 sm:px-6 bg-[#FFFDF9]/95 text-on-surface border-b border-border-sand flex items-center justify-between gap-4 shrink-0 z-20">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-headline italic text-lg font-medium truncate">
                {scene.projectName}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-tertiary-fixed text-tertiary-deep text-[10px] font-semibold uppercase tracking-wider shrink-0">
                Read-Only Client Share
              </span>
            </div>
            <p className="text-[11px] text-on-surface-variant truncate">
              {scene.shareLabel} • {scene.gaussianCount.toLocaleString()} Gaussians • {fps} FPS
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setCameraMode((m) => (m === 'orbit' ? 'fly' : 'orbit'))}
            className="px-3 py-1.5 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[15px]">
              {cameraMode === 'orbit' ? '360' : 'flight'}
            </span>
            <span>{cameraMode === 'orbit' ? 'Orbit' : 'Free-Fly (WASD)'}</span>
          </button>

          <button
            type="button"
            onClick={() => setRenderMode((m) => (m === 'splat' ? 'pointcloud' : 'splat'))}
            className="px-3 py-1.5 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold"
          >
            {renderMode === 'splat' ? '3D Splat' : 'Sparse Cloud'}
          </button>

          <button
            type="button"
            onClick={() => viewportRef.current?.resetCamera()}
            className="px-3 py-1.5 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold"
          >
            Reset View
          </button>

          {scene.cameraPath.length > 1 && (
            <button
              type="button"
              onClick={() => {
                if (pathPlaying) {
                  viewportRef.current?.stopCameraPath();
                } else {
                  viewportRef.current?.playCameraPath(scene.cameraPath);
                }
              }}
              className="px-3 py-1.5 rounded-full bg-primary text-on-primary text-xs font-semibold"
            >
              {pathPlaying ? 'Stop Tour' : 'Play Tour'}
            </button>
          )}
        </div>
      </header>

      <div className="relative flex-1 min-h-0">
        <SplatRoomViewport
          ref={viewportRef}
          cameraMode={cameraMode}
          flySpeed={flySpeed}
          renderMode={renderMode}
          sunAngleDeg={38}
          selectedObjectId=""
          objects={[]}
          objectOverrides={{}}
          showOriginalScene={scene.activeVersion !== 'edited'}
          splatUrl={scene.versions?.original?.splatUrl || scene.splatUrl}
          pointCloudUrl={
            scene.versions?.original?.sparseCloudUrl || scene.pointCloudUrl || undefined
          }
          editedSplatUrl={scene.versions?.edited?.splatUrl}
          editedPointCloudUrl={
            scene.versions?.edited?.sparseCloudUrl || activeVersion?.sparseCloudUrl || undefined
          }
          activeSceneVersion={scene.activeVersion || 'original'}
          viewerTransform={scene.viewerTransform}
          demoMode={false}
          onFpsUpdate={setFps}
          onPathPlayingChange={setPathPlaying}
        />

        <div className="absolute bottom-4 left-4 z-10 flex flex-wrap items-center gap-2 bg-white/90 backdrop-blur-md text-on-surface rounded-full px-4 py-2 shadow-lg border border-border-sand text-xs">
          <span className="font-semibold">Walk Speed</span>
          <input
            type="range"
            min={0.5}
            max={4}
            step={0.25}
            value={flySpeed}
            onChange={(e) => setFlySpeed(Number(e.target.value))}
            className="w-24 accent-primary"
          />
          {scene.cameraPoses.slice(0, 4).map((pose) => (
            <button
              key={pose.id}
              type="button"
              onClick={() => viewportRef.current?.loadCameraPose(pose)}
              className="px-2.5 py-1 rounded-full bg-surface-container hover:bg-primary hover:text-white transition-colors font-medium"
            >
              {pose.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
