import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import {
  getApiBaseUrl,
  getOrCreateSessionId,
  safeStorageGet,
  STORAGE_KEYS,
} from '../../services/api';
import type { CameraPose, ViewerTransform } from '../../types';
import {
  computeNavigationBounds,
  createSplatMesh,
  parsePlyBuffer,
  parseSplatBuffer,
  transformColmapPoseToThree,
  viewerTransformToMatrix4,
} from './loaders/index.ts';
import type { SplatRenderHandle } from './loaders/index.ts';

export type CameraControlMode = 'orbit' | 'fly';
export type ViewportRenderMode = 'splat' | 'pointcloud';
export type MovementDirection =
  | 'forward'
  | 'backward'
  | 'left'
  | 'right'
  | 'up'
  | 'down';
export interface ArtifactStatusInfo {
  mode: 'loading' | 'splat' | 'pointcloud' | 'pointcloud_fallback' | 'error';
  gaussianCount?: number;
  errorMessage?: string | null;
}
export interface SplatViewportHandle {
  focus: () => void;
  resetCamera: () => void;
  loadCameraPose: (pose: CameraPose) => void;
  setMovement: (direction: MovementDirection, active: boolean) => void;
}
export interface SplatRoomViewportProps {
  cameraMode: CameraControlMode;
  flySpeed: number;
  renderMode: ViewportRenderMode;
  splatUrl?: string;
  pointCloudUrl?: string;
  viewerTransform?: ViewerTransform;
  initialPose?: CameraPose;
  onArtifactStatusChange?: (status: ArtifactStatusInfo) => void;
  onFpsUpdate?: (fps: number) => void;
}
const KEY_DIRECTIONS: Record<string, MovementDirection> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'backward',
  ArrowDown: 'backward',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  KeyE: 'up',
  PageUp: 'up',
  KeyQ: 'down',
  PageDown: 'down',
};
async function artifactBuffer(
  url: string,
  signal: AbortSignal
): Promise<ArrayBuffer> {
  const target = new URL(url, window.location.href);
  const api = new URL(getApiBaseUrl() || '/api', window.location.href);
  const headers = new Headers();
  if (
    target.origin === api.origin &&
    (target.pathname === api.pathname ||
      target.pathname.startsWith(`${api.pathname.replace(/\/$/, '')}/`))
  ) {
    headers.set('X-Session-Id', getOrCreateSessionId());
    const token = safeStorageGet(STORAGE_KEYS.token);
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await fetch(target, { signal, headers });
  if (!response.ok)
    throw new Error(`Scene download failed (HTTP ${response.status}).`);
  return response.arrayBuffer();
}

export const SplatRoomViewport = forwardRef<
  SplatViewportHandle,
  SplatRoomViewportProps
>((props, ref) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const runtime = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    target: THREE.Vector3;
    bounds: ReturnType<typeof computeNavigationBounds>;
    splat?: SplatRenderHandle;
    cloud?: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
    initialized: boolean;
  } | null>(null);
  const heldCodes = useRef(new Set<string>());
  const touchMovement = useRef(new Set<MovementDirection>());
  const dirty = useRef(true);
  const advanceMovement = useRef<(now: number) => void>(() => {});
  const [status, setStatus] = useState<ArtifactStatusInfo>({ mode: 'loading' });
  const [retry, setRetry] = useState(0);
  const [ready, setReady] = useState(false);
  const report = (next: ArtifactStatusInfo) => {
    setStatus(next);
    propsRef.current.onArtifactStatusChange?.(next);
  };
  const applyPose = (pose: CameraPose) => {
    const state = runtime.current;
    if (!state) return;
    const converted =
      pose.coordinateSpace === 'threejs'
        ? pose
        : transformColmapPoseToThree(pose, propsRef.current.viewerTransform);
    state.camera.position.set(...converted.position);
    state.target.set(...converted.target);
    state.camera.up.set(...(pose.up || [0, 1, 0]));
    state.camera.fov = pose.fov || 55;
    state.camera.updateProjectionMatrix();
    state.camera.lookAt(state.target);
    dirty.current = true;
  };
  useImperativeHandle(ref, () => ({
    focus() {
      mountRef.current?.focus({ preventScroll: true });
    },
    resetCamera() {
      const state = runtime.current;
      if (!state) return;
      if (propsRef.current.initialPose) applyPose(propsRef.current.initialPose);
      else {
        state.camera.position.copy(state.bounds.defaultCameraPos);
        state.target.copy(state.bounds.defaultTarget);
        state.camera.up.set(0, 1, 0);
        state.camera.fov = 55;
        state.camera.updateProjectionMatrix();
        state.camera.lookAt(state.target);
      }
      heldCodes.current.clear();
      touchMovement.current.clear();
      dirty.current = true;
    },
    loadCameraPose: applyPose,
    setMovement(direction, active) {
      advanceMovement.current(performance.now());
      if (active) touchMovement.current.add(direction);
      else touchMovement.current.delete(direction);
    },
  }));

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false });
    } catch {
      report({
        mode: 'error',
        errorMessage:
          'WebGL is unavailable. Enable browser hardware acceleration and reload the viewer.',
      });
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor('#25221f');
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 10000);
    const bounds = computeNavigationBounds(
      null,
      propsRef.current.viewerTransform
    );
    const target = bounds.defaultTarget.clone();
    camera.position.copy(bounds.defaultCameraPos);
    camera.lookAt(target);
    const state = {
      renderer,
      scene: new THREE.Scene(),
      camera,
      target,
      bounds,
      initialized: false,
    };
    runtime.current = state;
    setReady(true);
    const resize = () => {
      const width = Math.max(host.clientWidth, 1),
        height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      runtime.current?.splat?.setViewportSize(width, height);
      dirty.current = true;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDistance = 0;
    const zoom = (delta: number) => {
      if (propsRef.current.cameraMode !== 'orbit') return;
      const offset = camera.position.clone().sub(target);
      const radius = THREE.MathUtils.clamp(
        offset.length() * Math.exp(delta * 0.001),
        runtime.current!.bounds.minRadius,
        runtime.current!.bounds.maxRadius
      );
      camera.position.copy(target).add(offset.setLength(radius));
      dirty.current = true;
    };
    const down = (event: PointerEvent) => {
      host.focus({ preventScroll: true });
      host.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      pinchDistance = 0;
    };
    const move = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      advanceMovement.current(performance.now());
      const dx = event.clientX - previous.x,
        dy = event.clientY - previous.y;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDistance) zoom((pinchDistance - distance) * 3);
        pinchDistance = distance;
      } else if (propsRef.current.cameraMode === 'fly') {
        const euler = new THREE.Euler().setFromQuaternion(
          camera.quaternion,
          'YXZ'
        );
        euler.y -= dx * 0.004;
        euler.x = THREE.MathUtils.clamp(
          euler.x - dy * 0.004,
          -Math.PI * 0.49,
          Math.PI * 0.49
        );
        camera.quaternion.setFromEuler(euler);
        target
          .copy(camera.position)
          .add(camera.getWorldDirection(new THREE.Vector3()));
      } else if ((event.buttons & 2) !== 0 || event.shiftKey) {
        const shift = new THREE.Vector3(-dx, dy, 0)
          .multiplyScalar(
            camera.position.distanceTo(target) / Math.max(host.clientHeight, 1)
          )
          .applyQuaternion(camera.quaternion);
        camera.position.add(shift);
        target.add(shift);
      } else {
        const spherical = new THREE.Spherical().setFromVector3(
          camera.position.clone().sub(target)
        );
        spherical.theta -= dx * 0.005;
        spherical.phi = THREE.MathUtils.clamp(
          spherical.phi - dy * 0.005,
          0.03,
          Math.PI - 0.03
        );
        camera.position
          .copy(target)
          .add(new THREE.Vector3().setFromSpherical(spherical));
        camera.lookAt(target);
      }
      dirty.current = true;
    };
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      pinchDistance = 0;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom(event.deltaY);
    };
    const keydown = (event: KeyboardEvent) => {
      if (propsRef.current.cameraMode !== 'fly' || !KEY_DIRECTIONS[event.code])
        return;
      event.preventDefault();
      advanceMovement.current(performance.now());
      heldCodes.current.add(event.code);
    };
    const keyup = (event: KeyboardEvent) => {
      advanceMovement.current(performance.now());
      heldCodes.current.delete(event.code);
    };
    const clear = () => {
      advanceMovement.current(performance.now());
      heldCodes.current.clear();
      touchMovement.current.clear();
      pointers.clear();
    };
    const context = (event: Event) => event.preventDefault();
    host.addEventListener('pointerdown', down);
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerup', up);
    host.addEventListener('pointercancel', up);
    host.addEventListener('lostpointercapture', up);
    host.addEventListener('wheel', wheel, { passive: false });
    host.addEventListener('keydown', keydown);
    host.addEventListener('blur', clear);
    host.addEventListener('contextmenu', context);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', clear);
    const visibility = () => {
      if (document.hidden) clear();
    };
    document.addEventListener('visibilitychange', visibility);
    let animation = 0,
      previous = performance.now(),
      fpsStart = previous,
      frames = 0;
    advanceMovement.current = (now: number) => {
      // Preserve ordinary slow frames; cap long stalls without catching up after suspension.
      const dt = Math.min(Math.max((now - previous) / 1000, 0), 1);
      previous = Math.max(previous, now);
      if (propsRef.current.cameraMode === 'fly') {
        const directions = new Set(
          [...heldCodes.current].map((code) => KEY_DIRECTIONS[code])
        );
        touchMovement.current.forEach((direction) => directions.add(direction));
        const movement = new THREE.Vector3(
          Number(directions.has('right')) - Number(directions.has('left')),
          Number(directions.has('up')) - Number(directions.has('down')),
          Number(directions.has('backward')) - Number(directions.has('forward'))
        );
        if (movement.lengthSq()) {
          movement
            .normalize()
            .applyQuaternion(camera.quaternion)
            .multiplyScalar(dt * propsRef.current.flySpeed);
          camera.position
            .add(movement)
            .clamp(
              runtime.current!.bounds.boundsBox.min,
              runtime.current!.bounds.boundsBox.max
            );
          target
            .copy(camera.position)
            .add(camera.getWorldDirection(new THREE.Vector3()));
          dirty.current = true;
        }
      }
    };
    const animate = (now: number) => {
      advanceMovement.current(now);
      if (dirty.current) {
        runtime.current?.splat?.sortByCamera(camera);
        renderer.render(state.scene, camera);
        dirty.current = false;
        frames++;
      }
      if (now - fpsStart >= 1000) {
        propsRef.current.onFpsUpdate?.(
          Math.round((frames * 1000) / (now - fpsStart))
        );
        frames = 0;
        fpsStart = now;
      }
      animation = requestAnimationFrame(animate);
    };
    animation = requestAnimationFrame(animate);
    return () => {
      clear();
      advanceMovement.current = () => {};
      cancelAnimationFrame(animation);
      observer.disconnect();
      host.removeEventListener('pointerdown', down);
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', up);
      host.removeEventListener('pointercancel', up);
      host.removeEventListener('lostpointercapture', up);
      host.removeEventListener('wheel', wheel);
      host.removeEventListener('keydown', keydown);
      host.removeEventListener('blur', clear);
      host.removeEventListener('contextmenu', context);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', visibility);
      runtime.current?.splat?.dispose();
      runtime.current?.cloud?.geometry.dispose();
      runtime.current?.cloud?.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      runtime.current = null;
    };
  }, []);
  useEffect(() => {
    advanceMovement.current(performance.now());
    heldCodes.current.clear();
    touchMovement.current.clear();
  }, [props.cameraMode]);
  useEffect(() => {
    const state = runtime.current;
    if (!state || !ready) return;
    const controller = new AbortController();
    const clearArtifact = () => {
      dirty.current = true;
      if (state.splat) {
        state.scene.remove(state.splat.mesh);
        state.splat.dispose();
        state.splat = undefined;
      }
      if (state.cloud) {
        state.scene.remove(state.cloud);
        state.cloud.geometry.dispose();
        state.cloud.material.dispose();
        state.cloud = undefined;
      }
    };
    const load = async () => {
      report({ mode: 'loading' });
      clearArtifact();
      const transform = viewerTransformToMatrix4(props.viewerTransform);
      let splatError = '',
        box: THREE.Box3 | undefined,
        count = 0;
      if (props.renderMode === 'splat') {
        try {
          if (!props.splatUrl)
            throw new Error(
              'The reconstruction has no Gaussian splat artifact.'
            );
          const buffer = await artifactBuffer(
            props.splatUrl,
            controller.signal
          );
          if (controller.signal.aborted) return;
          const parsed = parseSplatBuffer(buffer, {
            transformMatrix: transform,
          });
          state.splat = createSplatMesh(parsed, {
            viewportWidth: mountRef.current?.clientWidth || 960,
            viewportHeight: mountRef.current?.clientHeight || 600,
          });
          state.scene.add(state.splat.mesh);
          box = parsed.boundingBox;
          count = parsed.count;
        } catch (error) {
          if (controller.signal.aborted) return;
          splatError =
            error instanceof Error
              ? error.message
              : 'Gaussian splat could not be loaded.';
        }
      }
      if (!box) {
        try {
          if (!props.pointCloudUrl)
            throw new Error('No sparse point cloud artifact is available.');
          const buffer = await artifactBuffer(
            props.pointCloudUrl,
            controller.signal
          );
          if (controller.signal.aborted) return;
          const parsed = parsePlyBuffer(buffer, { transformMatrix: transform });
          const material = new THREE.PointsMaterial({
            vertexColors: true,
            size: Math.max(
              parsed.boundingBox.getSize(new THREE.Vector3()).length() * 0.001,
              0.002
            ),
            sizeAttenuation: true,
          });
          state.cloud = new THREE.Points(parsed.geometry, material);
          state.scene.add(state.cloud);
          box = parsed.boundingBox;
          count = parsed.count;
        } catch (error) {
          if (controller.signal.aborted) return;
          report({
            mode: 'error',
            errorMessage: [
              splatError,
              error instanceof Error
                ? error.message
                : 'Point cloud could not be loaded.',
            ]
              .filter(Boolean)
              .join(' '),
          });
          return;
        }
      }
      state.bounds = computeNavigationBounds(box, props.viewerTransform);
      state.camera.near = Math.max(state.bounds.radius * 0.0001, 0.0001);
      state.camera.far = Math.max(state.bounds.radius * 100, 100);
      state.camera.updateProjectionMatrix();
      if (!state.initialized) {
        state.initialized = true;
        if (props.initialPose) applyPose(props.initialPose);
        else {
          state.camera.position.copy(state.bounds.defaultCameraPos);
          state.target.copy(state.bounds.defaultTarget);
          state.camera.lookAt(state.target);
        }
      }
      report({
        mode: state.splat
          ? 'splat'
          : splatError
            ? 'pointcloud_fallback'
            : 'pointcloud',
        gaussianCount: count,
        errorMessage: splatError || null,
      });
      dirty.current = true;
    };
    void load();
    return () => controller.abort();
  }, [
    ready,
    props.splatUrl,
    props.pointCloudUrl,
    props.renderMode,
    props.viewerTransform,
    retry,
  ]);
  return (
    <div className="relative h-full w-full bg-[#25221f]">
      <div
        ref={mountRef}
        tabIndex={0}
        role="application"
        aria-label="3D room viewer. Drag to look around. In walk mode use W A S D or arrow keys; Q and E move down and up."
        className="h-full w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary cursor-grab active:cursor-grabbing"
      />
      {status.mode === 'loading' && (
        <div
          role="status"
          className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20"
        >
          <span className="rounded-2xl bg-surface px-5 py-3 text-sm text-on-surface shadow-lg">
            Loading reconstructed scene…
          </span>
        </div>
      )}
      {status.mode === 'pointcloud_fallback' && (
        <div
          role="status"
          className="absolute top-3 left-3 right-3 rounded-xl bg-amber-50 px-4 py-2 text-xs text-amber-950"
        >
          Splat unavailable. Showing the actual sparse point cloud.{' '}
          {status.errorMessage}
        </div>
      )}
      {status.mode === 'error' && (
        <div
          role="alert"
          className="absolute inset-0 flex items-center justify-center bg-surface/95 p-6"
        >
          <div className="max-w-md rounded-3xl border border-border-sand bg-white p-7 text-center text-on-surface shadow-xl">
            <span className="material-symbols-outlined text-3xl text-error">
              view_in_ar
            </span>
            <h2 className="font-headline text-2xl mt-3">Scene unavailable</h2>
            <p className="text-sm text-on-surface-variant mt-3 break-words">
              {status.errorMessage}
            </p>
            <button
              type="button"
              onClick={() => {
                if (!runtime.current) window.location.reload();
                else setRetry((value) => value + 1);
              }}
              className="mt-5 rounded-full bg-primary px-5 py-2 text-white"
            >
              Retry scene
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
SplatRoomViewport.displayName = 'SplatRoomViewport';
