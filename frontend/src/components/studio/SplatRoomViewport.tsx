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
import type {
  CameraPathKeyframe,
  CameraPose,
  SceneObjectInfo,
  ViewerTransform,
} from '../../types';
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
export type SceneVersionKind = 'original' | 'edited';

export interface ObjectOverrideStyle {
  colorHex: string;
  label: string;
}

export interface ArtifactStatusInfo {
  mode: 'demo' | 'loading' | 'splat' | 'pointcloud_fallback' | 'error';
  version: SceneVersionKind;
  gaussianCount?: number;
  errorMessage?: string | null;
}

export interface SplatViewportHandle {
  resetCamera: () => void;
  loadCameraPose: (pose: CameraPose) => void;
  playCameraPath: (keyframes: CameraPathKeyframe[]) => void;
  stopCameraPath: () => void;
}

export interface SplatRoomViewportProps {
  cameraMode: CameraControlMode;
  flySpeed: number;
  renderMode: ViewportRenderMode;
  sunAngleDeg: number;
  selectedObjectId: string;
  objects: SceneObjectInfo[];
  objectOverrides: Record<string, ObjectOverrideStyle>;
  showOriginalScene: boolean;
  /** Live artifact URLs for original scene version */
  splatUrl?: string;
  pointCloudUrl?: string;
  /** Live artifact URLs for edited scene version */
  editedSplatUrl?: string;
  editedPointCloudUrl?: string;
  /** Controls which persisted scene artifact version is active without moving camera */
  activeSceneVersion?: SceneVersionKind;
  /** Canonical COLMAP -> Three.js transform from RunManifest / SceneResponse */
  viewerTransform?: ViewerTransform;
  /** Procedural demo room ONLY renders when demoMode is explicitly true */
  demoMode?: boolean;
  onArtifactStatusChange?: (status: ArtifactStatusInfo) => void;
  onScreenClick?: (xPct: number, yPct: number, hitObjectId: string | null) => void;
  onFpsUpdate?: (fps: number) => void;
  onPathPlayingChange?: (playing: boolean) => void;
}

const DEFAULT_DEMO_CAMERA_POS = new THREE.Vector3(4.2, 2.35, 4.6);
const DEFAULT_DEMO_TARGET = new THREE.Vector3(-0.2, 0.75, -0.2);

interface NavBoundsState {
  boundsBox: THREE.Box3;
  defaultCameraPos: THREE.Vector3;
  defaultTarget: THREE.Vector3;
  minRadius: number;
  maxRadius: number;
}

function clampToBounds(pos: THREE.Vector3, box: THREE.Box3): void {
  pos.x = Math.max(box.min.x, Math.min(box.max.x, pos.x));
  pos.y = Math.max(box.min.y, Math.min(box.max.y, pos.y));
  pos.z = Math.max(box.min.z, Math.min(box.max.z, pos.z));
}

function createSplatSpriteTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.85)');
    grad.addColorStop(0.75, 'rgba(255, 255, 255, 0.22)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function buildGaussianRoomPoints(
  includeDense: boolean
): { geometry: THREE.BufferGeometry; count: number } {
  const positions: number[] = [];
  const colors: number[] = [];

  const pushBoxPoints = (
    cx: number,
    cy: number,
    cz: number,
    wx: number,
    hy: number,
    dz: number,
    n: number,
    baseHex: string,
    jitter = 0.06
  ) => {
    const c = new THREE.Color(baseHex);
    for (let i = 0; i < n; i++) {
      positions.push(
        cx + (Math.random() - 0.5) * wx,
        cy + (Math.random() - 0.5) * hy,
        cz + (Math.random() - 0.5) * dz
      );
      const shade = 1 + (Math.random() - 0.5) * jitter * 3;
      colors.push(
        Math.min(1, c.r * shade),
        Math.min(1, c.g * shade),
        Math.min(1, c.b * shade)
      );
    }
  };

  const scale = includeDense ? 1 : 0.45;
  const q = (n: number) => Math.max(20, Math.round(n * scale));

  pushBoxPoints(0, 0.02, 0, 8.2, 0.04, 7.6, q(1600), '#C8A57E', 0.12);
  pushBoxPoints(0.05, 0.05, -0.3, 3.8, 0.03, 2.8, q(650), '#DDD0BE', 0.08);
  pushBoxPoints(0, 1.85, -3.7, 8.2, 3.7, 0.12, q(900), '#F5ECE3', 0.06);
  pushBoxPoints(-4.0, 1.85, 0, 0.12, 3.7, 7.6, q(700), '#EFE3D7', 0.07);
  pushBoxPoints(0.25, 0.48, -1.7, 2.6, 0.72, 1.0, q(650), '#ECE2D4', 0.09);
  pushBoxPoints(-1.45, 0.52, 0.55, 0.95, 0.8, 0.92, q(450), '#B67247', 0.1);
  pushBoxPoints(0.15, 0.28, -0.15, 1.25, 0.36, 0.72, q(350), '#D7CABD', 0.08);
  pushBoxPoints(-2.9, 0.95, -2.5, 0.85, 1.6, 0.85, q(360), '#4E6747', 0.16);
  pushBoxPoints(-1.2, 1.4, -0.4, 3.8, 2.2, 3.5, q(260), '#FBE0A6', 0.1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return { geometry, count: positions.length / 3 };
}

function buildArtifactFetchInit(url: string, signal: AbortSignal): RequestInit {
  const headers = new Headers();
  const apiBase = getApiBaseUrl();
  const isSameOrApiOrigin =
    url.startsWith('/') ||
    (apiBase && url.startsWith(apiBase)) ||
    (typeof window !== 'undefined' && url.startsWith(window.location.origin));

  if (isSameOrApiOrigin) {
    headers.set('X-Session-Id', getOrCreateSessionId());
    const token = safeStorageGet(STORAGE_KEYS.token);
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }
  return { headers, signal };
}

async function fetchArtifactBuffer(
  url: string,
  cache: Map<string, ArrayBuffer>,
  signal: AbortSignal
): Promise<ArrayBuffer> {
  const cached = cache.get(url);
  if (cached) {
    return cached;
  }
  const res = await fetch(url, buildArtifactFetchInit(url, signal));
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0) {
    throw new Error(`Empty 0-byte artifact returned from ${url}`);
  }
  if (cache.size >= 4) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(url, buf);
  return buf;
}

function disposeObject3DResources(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (
      obj instanceof THREE.Mesh ||
      obj instanceof THREE.Points ||
      obj instanceof THREE.Line
    ) {
      obj.geometry?.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m) continue;
        if ('map' in m && m.map instanceof THREE.Texture) {
          m.map.dispose();
        }
        m.dispose();
      }
    }
  });
}

export const SplatRoomViewport = forwardRef<SplatViewportHandle, SplatRoomViewportProps>(
  (
    {
      cameraMode,
      flySpeed,
      renderMode,
      sunAngleDeg,
      selectedObjectId,
      objects,
      objectOverrides,
      showOriginalScene,
      splatUrl,
      pointCloudUrl,
      editedSplatUrl,
      editedPointCloudUrl,
      activeSceneVersion,
      viewerTransform,
      demoMode = false,
      onArtifactStatusChange,
      onScreenClick,
      onFpsUpdate,
      onPathPlayingChange,
    },
    ref
  ) => {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const [webglUnavailable, setWebglUnavailable] = useState(false);
    const [reloadNonce, setReloadNonce] = useState(0);

    const effectiveVersion: SceneVersionKind =
      activeSceneVersion ?? (showOriginalScene ? 'original' : 'edited');

    const [artifactUiState, setArtifactUiState] = useState<{
      mode: ArtifactStatusInfo['mode'];
      errorMessage: string | null;
      gaussianCount: number;
    }>({
      mode: demoMode ? 'demo' : 'loading',
      errorMessage: null,
      gaussianCount: 0,
    });

    const cameraModeRef = useRef<CameraControlMode>(cameraMode);
    cameraModeRef.current = cameraMode;
    const flySpeedRef = useRef<number>(flySpeed);
    flySpeedRef.current = flySpeed;
    const viewerTransformRef = useRef<ViewerTransform | undefined>(viewerTransform);
    viewerTransformRef.current = viewerTransform;
    const onScreenClickRef = useRef(onScreenClick);
    onScreenClickRef.current = onScreenClick;
    const onFpsRef = useRef(onFpsUpdate);
    onFpsRef.current = onFpsUpdate;
    const onPathPlayingRef = useRef(onPathPlayingChange);
    onPathPlayingRef.current = onPathPlayingChange;
    const onArtifactStatusRef = useRef(onArtifactStatusChange);
    onArtifactStatusRef.current = onArtifactStatusChange;

    const sceneObjectsRef = useRef<{
      scene?: THREE.Scene;
      renderer?: THREE.WebGLRenderer;
      camera?: THREE.PerspectiveCamera;
      sunLight?: THREE.DirectionalLight;
      demoGroup?: THREE.Group;
      artifactGroup?: THREE.Group;
      activeSplatHandle?: SplatRenderHandle;
      activePointCloud?: THREE.Points;
      splatTex?: THREE.CanvasTexture;
      solidGroup?: THREE.Group;
      splatPoints?: THREE.Points;
      sparsePoints?: THREE.Points;
      selectionHalo?: THREE.Mesh;
      furnitureMaterials: Record<
        string,
        { mat: THREE.MeshStandardMaterial; originalHex: string }
      >;
      furnitureGroups: Record<string, THREE.Object3D>;
      target: THREE.Vector3;
      spherical: THREE.Spherical;
      flyEuler: THREE.Euler;
      navBounds: NavBoundsState;
      hasInitializedLiveCamera: boolean;
      artifactCache: Map<string, ArrayBuffer>;
      tween: {
        active: boolean;
        startPos: THREE.Vector3;
        startTarget: THREE.Vector3;
        endPos: THREE.Vector3;
        endTarget: THREE.Vector3;
        elapsed: number;
        duration: number;
      };
      pathQueue: CameraPathKeyframe[];
      pathActive: boolean;
    }>({
      furnitureMaterials: {},
      furnitureGroups: {},
      target: DEFAULT_DEMO_TARGET.clone(),
      spherical: new THREE.Spherical(6.4, 1.24, 0.75),
      flyEuler: new THREE.Euler(0, 0, 0, 'YXZ'),
      navBounds: {
        boundsBox: new THREE.Box3(
          new THREE.Vector3(-3.6, 0.35, -3.2),
          new THREE.Vector3(4.6, 3.4, 5.2)
        ),
        defaultCameraPos: DEFAULT_DEMO_CAMERA_POS.clone(),
        defaultTarget: DEFAULT_DEMO_TARGET.clone(),
        minRadius: 1.2,
        maxRadius: 14.0,
      },
      hasInitializedLiveCamera: false,
      artifactCache: new Map(),
      tween: {
        active: false,
        startPos: new THREE.Vector3(),
        startTarget: new THREE.Vector3(),
        endPos: new THREE.Vector3(),
        endTarget: new THREE.Vector3(),
        elapsed: 0,
        duration: 0.7,
      },
      pathQueue: [],
      pathActive: false,
    });

    useImperativeHandle(ref, () => ({
      resetCamera() {
        const st = sceneObjectsRef.current;
        if (!st.camera) return;
        st.pathActive = false;
        st.pathQueue = [];
        onPathPlayingRef.current?.(false);
        st.tween = {
          active: true,
          startPos: st.camera.position.clone(),
          startTarget: st.target.clone(),
          endPos: st.navBounds.defaultCameraPos.clone(),
          endTarget: st.navBounds.defaultTarget.clone(),
          elapsed: 0,
          duration: 0.75,
        };
      },
      loadCameraPose(pose: CameraPose) {
        const st = sceneObjectsRef.current;
        if (!st.camera) return;
        st.pathActive = false;
        st.pathQueue = [];
        onPathPlayingRef.current?.(false);

        const maybeColmap = pose as CameraPose & { coordinateSpace?: 'colmap' | 'threejs' };
        const resolvedPose =
          maybeColmap.coordinateSpace === 'colmap'
            ? transformColmapPoseToThree(pose, viewerTransformRef.current)
            : pose;

        st.tween = {
          active: true,
          startPos: st.camera.position.clone(),
          startTarget: st.target.clone(),
          endPos: new THREE.Vector3(...resolvedPose.position),
          endTarget: new THREE.Vector3(...resolvedPose.target),
          elapsed: 0,
          duration: 0.75,
        };
        if (resolvedPose.fov && st.camera.fov !== resolvedPose.fov) {
          st.camera.fov = resolvedPose.fov;
          st.camera.updateProjectionMatrix();
        }
      },
      playCameraPath(keyframes: CameraPathKeyframe[]) {
        const st = sceneObjectsRef.current;
        if (!st.camera || keyframes.length === 0) return;
        st.pathQueue = [...keyframes];
        st.pathActive = true;
        onPathPlayingRef.current?.(true);
        const first = st.pathQueue.shift();
        if (first) {
          st.tween = {
            active: true,
            startPos: st.camera.position.clone(),
            startTarget: st.target.clone(),
            endPos: new THREE.Vector3(...first.position),
            endTarget: new THREE.Vector3(...first.target),
            elapsed: 0,
            duration: first.durationMs / 1000,
          };
        }
      },
      stopCameraPath() {
        const st = sceneObjectsRef.current;
        st.pathActive = false;
        st.pathQueue = [];
        st.tween.active = false;
        onPathPlayingRef.current?.(false);
      },
    }));

    // Initialize WebGL scene, camera, lights, controls, and animation loop once
    useEffect(() => {
      const container = mountRef.current;
      if (!container) return;

      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
        });
      } catch {
        setWebglUnavailable(true);
        return;
      }

      const width = container.clientWidth || 960;
      const height = container.clientHeight || 600;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      container.innerHTML = '';
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#F5ECE3');

      const camera = new THREE.PerspectiveCamera(48, width / height, 0.05, 120);
      camera.position.copy(DEFAULT_DEMO_CAMERA_POS);
      const st = sceneObjectsRef.current;
      st.scene = scene;
      st.renderer = renderer;
      st.camera = camera;
      st.target.copy(DEFAULT_DEMO_TARGET);
      camera.lookAt(st.target);
      st.spherical.setFromVector3(camera.position.clone().sub(st.target));
      st.flyEuler.setFromQuaternion(camera.quaternion, 'YXZ');

      const hemi = new THREE.HemisphereLight('#FFF8EC', '#B89E8A', 1.15);
      scene.add(hemi);

      const sunLight = new THREE.DirectionalLight('#FFE4B8', 2.2);
      sunLight.position.set(-5.5, 5.2, 3.2);
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(1024, 1024);
      sunLight.shadow.camera.near = 0.5;
      sunLight.shadow.camera.far = 20;
      sunLight.shadow.camera.left = -6;
      sunLight.shadow.camera.right = 6;
      sunLight.shadow.camera.top = 6;
      sunLight.shadow.camera.bottom = -6;
      scene.add(sunLight);
      st.sunLight = sunLight;

      const fillLight = new THREE.PointLight('#FFF1DC', 0.9, 14);
      fillLight.position.set(2.5, 2.8, 2.5);
      scene.add(fillLight);

      const demoGroup = new THREE.Group();
      demoGroup.visible = false;
      scene.add(demoGroup);
      st.demoGroup = demoGroup;

      const artifactGroup = new THREE.Group();
      scene.add(artifactGroup);
      st.artifactGroup = artifactGroup;

      const splatTex = createSplatSpriteTexture();
      st.splatTex = splatTex;

      const keysDown = new Set<string>();
      let dragging = false;
      let dragButton = 0;
      let lastX = 0;
      let lastY = 0;
      let movedPx = 0;

      const raycaster = new THREE.Raycaster();
      raycaster.params.Points.threshold = 0.08;
      const domEl = renderer.domElement;

      const clearKeys = () => keysDown.clear();

      const handleVisibilityChange = () => {
        if (document.hidden) keysDown.clear();
      };

      const handleContextLost = (e: Event) => {
        e.preventDefault();
        setWebglUnavailable(true);
      };

      const handlePointerDown = (e: PointerEvent) => {
        dragging = true;
        dragButton = e.button;
        lastX = e.clientX;
        lastY = e.clientY;
        movedPx = 0;
        if (st.pathActive) {
          st.pathActive = false;
          st.pathQueue = [];
          onPathPlayingRef.current?.(false);
        }
        st.tween.active = false;
      };

      const handlePointerMove = (e: PointerEvent) => {
        if (!dragging) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        movedPx += Math.hypot(dx, dy);

        if (cameraModeRef.current === 'orbit') {
          if (dragButton === 2 || e.shiftKey) {
            const right = new THREE.Vector3();
            const up = new THREE.Vector3();
            camera.getWorldDirection(up);
            right.crossVectors(up, camera.up).normalize();
            const panUp = new THREE.Vector3().crossVectors(right, up).normalize();
            const panScale = st.spherical.radius * 0.0014;
            st.target.addScaledVector(right, -dx * panScale);
            st.target.addScaledVector(panUp, dy * panScale);
          } else {
            st.spherical.theta -= dx * 0.0065;
            st.spherical.phi = Math.max(
              0.15,
              Math.min(Math.PI - 0.15, st.spherical.phi - dy * 0.0065)
            );
          }
          const offset = new THREE.Vector3().setFromSpherical(st.spherical);
          camera.position.copy(st.target).add(offset);
          camera.lookAt(st.target);
          st.flyEuler.setFromQuaternion(camera.quaternion, 'YXZ');
        } else {
          st.flyEuler.y -= dx * 0.0038;
          st.flyEuler.x = Math.max(
            -Math.PI / 2.2,
            Math.min(Math.PI / 2.2, st.flyEuler.x - dy * 0.0038)
          );
          camera.quaternion.setFromEuler(st.flyEuler);
          const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
          st.target.copy(camera.position).addScaledVector(fwd, 3.0);
          st.spherical.setFromVector3(camera.position.clone().sub(st.target));
        }
      };

      const handlePointerUp = (e: PointerEvent) => {
        if (!dragging) return;
        dragging = false;

        if (dragButton === 0 && movedPx < 6) {
          const rect = domEl.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          const xPct = ((e.clientX - rect.left) / rect.width) * 100;
          const yPct = ((e.clientY - rect.top) / rect.height) * 100;
          const ndc = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
          );
          raycaster.setFromCamera(ndc, camera);
          const pickTargets =
            st.demoGroup?.visible && Object.keys(st.furnitureGroups).length > 0
              ? Object.values(st.furnitureGroups)
              : st.artifactGroup
                ? st.artifactGroup.children
                : [];
          const hits = raycaster.intersectObjects(pickTargets, true);
          let hitObjectId: string | null = null;
          if (hits.length > 0) {
            let cur: THREE.Object3D | null = hits[0].object;
            while (cur) {
              if (cur.userData.objectId) {
                hitObjectId = String(cur.userData.objectId);
                break;
              }
              cur = cur.parent;
            }
          }
          onScreenClickRef.current?.(xPct, yPct, hitObjectId);
        }
      };

      const handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        if (cameraModeRef.current === 'orbit') {
          st.spherical.radius = Math.max(
            st.navBounds.minRadius,
            Math.min(st.navBounds.maxRadius, st.spherical.radius + e.deltaY * 0.004)
          );
          const offset = new THREE.Vector3().setFromSpherical(st.spherical);
          camera.position.copy(st.target).add(offset);
          camera.lookAt(st.target);
        } else {
          const prevPos = camera.position.clone();
          const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
          camera.position.addScaledVector(fwd, -e.deltaY * 0.003 * flySpeedRef.current);
          clampToBounds(camera.position, st.navBounds.boundsBox);
          const actualDelta = camera.position.clone().sub(prevPos);
          st.target.add(actualDelta);
          st.spherical.setFromVector3(camera.position.clone().sub(st.target));
        }
      };

      const handleContextMenu = (e: MouseEvent) => e.preventDefault();

      const handleKeyDown = (e: KeyboardEvent) => {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        keysDown.add(e.key.toLowerCase());
      };

      const handleKeyUp = (e: KeyboardEvent) => {
        keysDown.delete(e.key.toLowerCase());
      };

      const handleResize = () => {
        if (!container) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w <= 0 || h <= 0) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        st.activeSplatHandle?.setViewportSize(w, h);
      };

      let resizeObserver: ResizeObserver | null = null;
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(container);
      }

      domEl.addEventListener('pointerdown', handlePointerDown);
      domEl.addEventListener('webglcontextlost', handleContextLost);
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      domEl.addEventListener('wheel', handleWheel, { passive: false });
      domEl.addEventListener('contextmenu', handleContextMenu);
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
      window.addEventListener('blur', clearKeys);
      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('resize', handleResize);

      let rafId = 0;
      let lastTime = performance.now();
      let fpsFrames = 0;
      let fpsTimer = lastTime;

      const animate = (now: number) => {
        rafId = window.requestAnimationFrame(animate);
        const dt = Math.min(0.05, (now - lastTime) / 1000);
        lastTime = now;

        if (st.tween.active) {
          st.tween.elapsed += dt;
          const t = Math.min(1, st.tween.elapsed / Math.max(0.1, st.tween.duration));
          const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          camera.position.lerpVectors(st.tween.startPos, st.tween.endPos, ease);
          st.target.lerpVectors(st.tween.startTarget, st.tween.endTarget, ease);
          camera.lookAt(st.target);
          st.spherical.setFromVector3(camera.position.clone().sub(st.target));
          st.flyEuler.setFromQuaternion(camera.quaternion, 'YXZ');

          if (t >= 1) {
            st.tween.active = false;
            if (st.pathActive && st.pathQueue.length > 0) {
              const nextKf = st.pathQueue.shift();
              if (nextKf) {
                st.tween = {
                  active: true,
                  startPos: camera.position.clone(),
                  startTarget: st.target.clone(),
                  endPos: new THREE.Vector3(...nextKf.position),
                  endTarget: new THREE.Vector3(...nextKf.target),
                  elapsed: 0,
                  duration: nextKf.durationMs / 1000,
                };
              }
            } else if (st.pathActive) {
              st.pathActive = false;
              onPathPlayingRef.current?.(false);
            }
          }
        }

        const moveVec = new THREE.Vector3();
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const speed = 2.6 * flySpeedRef.current * (keysDown.has('shift') ? 1.8 : 1.0) * dt;

        if (keysDown.has('w') || keysDown.has('arrowup')) moveVec.add(forward);
        if (keysDown.has('s') || keysDown.has('arrowdown')) moveVec.sub(forward);
        if (keysDown.has('d') || keysDown.has('arrowright')) moveVec.add(right);
        if (keysDown.has('a') || keysDown.has('arrowleft')) moveVec.sub(right);
        if (keysDown.has('e')) moveVec.y += 1;
        if (keysDown.has('q')) moveVec.y -= 1;

        if (moveVec.lengthSq() > 0) {
          const prevPos = camera.position.clone();
          moveVec.normalize().multiplyScalar(speed);
          camera.position.add(moveVec);
          clampToBounds(camera.position, st.navBounds.boundsBox);
          const actualDelta = camera.position.clone().sub(prevPos);
          st.target.add(actualDelta);
          st.spherical.setFromVector3(camera.position.clone().sub(st.target));
        }

        if (st.selectionHalo && st.demoGroup?.visible) {
          const pulse = 1 + Math.sin(now * 0.004) * 0.06;
          st.selectionHalo.scale.set(pulse, pulse, 1);
        }

        if (st.activeSplatHandle) {
          st.activeSplatHandle.sortByCamera(camera);
        }

        renderer.render(scene, camera);

        fpsFrames++;
        if (now - fpsTimer >= 1000) {
          onFpsRef.current?.(Math.min(60, Math.round((fpsFrames * 1000) / (now - fpsTimer))));
          fpsFrames = 0;
          fpsTimer = now;
        }
      };

      rafId = window.requestAnimationFrame(animate);

      return () => {
        window.cancelAnimationFrame(rafId);
        resizeObserver?.disconnect();
        domEl.removeEventListener('pointerdown', handlePointerDown);
        domEl.removeEventListener('webglcontextlost', handleContextLost);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        domEl.removeEventListener('wheel', handleWheel);
        domEl.removeEventListener('contextmenu', handleContextMenu);
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
        window.removeEventListener('blur', clearKeys);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('resize', handleResize);

        if (st.activeSplatHandle) {
          st.activeSplatHandle.dispose();
          st.activeSplatHandle = undefined;
        }
        if (st.activePointCloud) {
          st.activePointCloud.geometry.dispose();
          (st.activePointCloud.material as THREE.Material).dispose();
          st.activePointCloud = undefined;
        }
        disposeObject3DResources(scene);
        splatTex.dispose();
        renderer.dispose();
        st.artifactCache.clear();
        if (domEl.parentNode === container) {
          container.removeChild(domEl);
        }
      };
    }, []);

    // Build / dispose procedural demo room ONLY when demoMode === true
    useEffect(() => {
      const st = sceneObjectsRef.current;
      const demoGroup = st.demoGroup;
      const scene = st.scene;
      if (!demoGroup || !scene) return;

      const clearDemoRoom = () => {
        disposeObject3DResources(demoGroup);
        demoGroup.clear();
        st.solidGroup = undefined;
        st.splatPoints = undefined;
        st.sparsePoints = undefined;
        st.selectionHalo = undefined;
        st.furnitureMaterials = {};
        st.furnitureGroups = {};
      };

      if (!demoMode) {
        demoGroup.visible = false;
        clearDemoRoom();
        scene.fog = null;
        return;
      }

      clearDemoRoom();
      demoGroup.visible = true;
      scene.fog = new THREE.Fog('#F5ECE3', 10, 24);

      const solidGroup = new THREE.Group();
      demoGroup.add(solidGroup);
      st.solidGroup = solidGroup;

      const floorMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(8.4, 7.8),
        new THREE.MeshStandardMaterial({
          color: '#C9A57C',
          roughness: 0.72,
          metalness: 0.04,
        })
      );
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.receiveShadow = true;
      solidGroup.add(floorMesh);

      const gridHelper = new THREE.GridHelper(8.2, 16, '#B89B82', '#DFCFC0');
      gridHelper.position.y = 0.005;
      solidGroup.add(gridHelper);

      const wallMat = new THREE.MeshStandardMaterial({
        color: '#F4EAE0',
        roughness: 0.9,
      });
      const backWall = new THREE.Mesh(new THREE.BoxGeometry(8.4, 3.8, 0.14), wallMat);
      backWall.position.set(0, 1.9, -3.85);
      backWall.receiveShadow = true;
      solidGroup.add(backWall);

      const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.8, 7.8), wallMat);
      leftWall.position.set(-4.15, 1.9, 0);
      leftWall.receiveShadow = true;
      solidGroup.add(leftWall);

      const windowPane = new THREE.Mesh(
        new THREE.PlaneGeometry(2.4, 2.2),
        new THREE.MeshBasicMaterial({ color: '#FFF3D6' })
      );
      windowPane.position.set(-4.06, 1.85, -0.3);
      windowPane.rotation.y = Math.PI / 2;
      solidGroup.add(windowPane);

      const artFrame = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 1.05, 0.05),
        new THREE.MeshStandardMaterial({ color: '#7D573B', roughness: 0.55 })
      );
      artFrame.position.set(0.25, 2.05, -3.75);
      solidGroup.add(artFrame);
      const artCanvas = new THREE.Mesh(
        new THREE.PlaneGeometry(1.24, 0.9),
        new THREE.MeshStandardMaterial({ color: '#E8D5C3', roughness: 0.9 })
      );
      artCanvas.position.set(0.25, 2.05, -3.72);
      solidGroup.add(artCanvas);

      const rug = new THREE.Mesh(
        new THREE.BoxGeometry(3.8, 0.025, 2.7),
        new THREE.MeshStandardMaterial({ color: '#DFD2C0', roughness: 0.95 })
      );
      rug.position.set(0.05, 0.015, -0.35);
      rug.receiveShadow = true;
      solidGroup.add(rug);

      const armchairGroup = new THREE.Group();
      armchairGroup.position.set(-1.45, 0, 0.55);
      armchairGroup.rotation.y = 0.65;
      armchairGroup.userData.objectId = 'armchair';
      const armchairMat = new THREE.MeshStandardMaterial({
        color: '#B87549',
        roughness: 0.62,
        metalness: 0.05,
      });
      const woodMat = new THREE.MeshStandardMaterial({ color: '#6E472B', roughness: 0.5 });
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.18, 0.78), armchairMat);
      seat.position.y = 0.42;
      seat.castShadow = true;
      seat.receiveShadow = true;
      const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.56, 0.18), armchairMat);
      backrest.position.set(0, 0.72, -0.31);
      backrest.rotation.x = -0.14;
      backrest.castShadow = true;
      const armL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.28, 0.74), woodMat);
      armL.position.set(-0.42, 0.56, -0.02);
      armL.castShadow = true;
      const armR = armL.clone();
      armR.position.x = 0.42;
      armchairGroup.add(seat, backrest, armL, armR);
      [
        [-0.36, -0.32],
        [0.36, -0.32],
        [-0.36, 0.3],
        [0.36, 0.3],
      ].forEach(([lx, lz]) => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.35, 10), woodMat);
        leg.position.set(lx, 0.175, lz);
        leg.castShadow = true;
        armchairGroup.add(leg);
      });
      solidGroup.add(armchairGroup);
      st.furnitureMaterials.armchair = { mat: armchairMat, originalHex: '#B87549' };
      st.furnitureGroups.armchair = armchairGroup;

      const sofaGroup = new THREE.Group();
      sofaGroup.position.set(0.25, 0, -1.65);
      sofaGroup.userData.objectId = 'sofa';
      const sofaMat = new THREE.MeshStandardMaterial({
        color: '#EFE5D8',
        roughness: 0.85,
      });
      const sofaBase = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.28, 0.96), sofaMat);
      sofaBase.position.y = 0.24;
      sofaBase.castShadow = true;
      sofaBase.receiveShadow = true;
      const sofaBack = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.58, 0.22), sofaMat);
      sofaBack.position.set(0, 0.62, -0.37);
      sofaBack.castShadow = true;
      const sofaArmL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.44, 0.96), sofaMat);
      sofaArmL.position.set(-1.14, 0.46, 0);
      sofaArmL.castShadow = true;
      const sofaArmR = sofaArmL.clone();
      sofaArmR.position.x = 1.14;
      sofaGroup.add(sofaBase, sofaBack, sofaArmL, sofaArmR);
      solidGroup.add(sofaGroup);
      st.furnitureMaterials.sofa = { mat: sofaMat, originalHex: '#EFE5D8' };
      st.furnitureGroups.sofa = sofaGroup;

      const tableGroup = new THREE.Group();
      tableGroup.position.set(0.15, 0, -0.15);
      tableGroup.userData.objectId = 'table';
      const tableMat = new THREE.MeshStandardMaterial({
        color: '#DFD2C3',
        roughness: 0.45,
      });
      const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.08, 0.72), tableMat);
      tableTop.position.y = 0.36;
      tableTop.castShadow = true;
      tableTop.receiveShadow = true;
      const plinth1 = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.34, 16), tableMat);
      plinth1.position.set(-0.34, 0.17, 0);
      plinth1.castShadow = true;
      const plinth2 = plinth1.clone();
      plinth2.position.x = 0.34;
      tableGroup.add(tableTop, plinth1, plinth2);
      solidGroup.add(tableGroup);
      st.furnitureMaterials.table = { mat: tableMat, originalHex: '#DFD2C3' };
      st.furnitureGroups.table = tableGroup;

      const lampGroup = new THREE.Group();
      lampGroup.position.set(-2.1, 0, -1.55);
      lampGroup.userData.objectId = 'lamp';
      const lampMat = new THREE.MeshStandardMaterial({
        color: '#F3DFC1',
        emissive: '#F5BA62',
        emissiveIntensity: 0.25,
        roughness: 0.7,
      });
      const lampPole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.03, 1.5, 12),
        new THREE.MeshStandardMaterial({ color: '#9D7B4F', metalness: 0.65, roughness: 0.35 })
      );
      lampPole.position.y = 0.75;
      lampPole.castShadow = true;
      const lampBase = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.22, 0.05, 18),
        new THREE.MeshStandardMaterial({ color: '#4A3F38', roughness: 0.6 })
      );
      lampBase.position.y = 0.025;
      const lampShade = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 0.36, 20), lampMat);
      lampShade.position.y = 1.56;
      lampShade.castShadow = true;
      lampGroup.add(lampBase, lampPole, lampShade);
      solidGroup.add(lampGroup);
      st.furnitureMaterials.lamp = { mat: lampMat, originalHex: '#F3DFC1' };
      st.furnitureGroups.lamp = lampGroup;

      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.18, 0.42, 16),
        new THREE.MeshStandardMaterial({ color: '#C2613B', roughness: 0.8 })
      );
      pot.position.set(-2.9, 0.21, -2.5);
      pot.castShadow = true;
      const foliage = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.45, 1),
        new THREE.MeshStandardMaterial({ color: '#4A5A43', roughness: 0.85 })
      );
      foliage.position.set(-2.9, 1.05, -2.5);
      foliage.castShadow = true;
      solidGroup.add(pot, foliage);

      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.62, 0.7, 36),
        new THREE.MeshBasicMaterial({
          color: '#C2613B',
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85,
        })
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.set(-1.45, 0.025, 0.55);
      demoGroup.add(halo);
      st.selectionHalo = halo;

      const denseData = buildGaussianRoomPoints(true);
      const splatPoints = new THREE.Points(
        denseData.geometry,
        new THREE.PointsMaterial({
          size: 0.14,
          map: st.splatTex,
          vertexColors: true,
          transparent: true,
          opacity: 0.52,
          depthWrite: false,
        })
      );
      demoGroup.add(splatPoints);
      st.splatPoints = splatPoints;

      const sparseData = buildGaussianRoomPoints(false);
      const sparsePoints = new THREE.Points(
        sparseData.geometry,
        new THREE.PointsMaterial({
          size: 0.09,
          map: st.splatTex,
          vertexColors: true,
          transparent: true,
          opacity: 0.92,
          depthWrite: false,
        })
      );
      sparsePoints.visible = false;
      demoGroup.add(sparsePoints);
      st.sparsePoints = sparsePoints;

      st.navBounds = {
        boundsBox: new THREE.Box3(
          new THREE.Vector3(-3.6, 0.35, -3.2),
          new THREE.Vector3(4.6, 3.4, 5.2)
        ),
        defaultCameraPos: DEFAULT_DEMO_CAMERA_POS.clone(),
        defaultTarget: DEFAULT_DEMO_TARGET.clone(),
        minRadius: 1.8,
        maxRadius: 12.5,
      };

      const status: ArtifactStatusInfo = { mode: 'demo', version: effectiveVersion };
      setArtifactUiState({ mode: 'demo', errorMessage: null, gaussianCount: denseData.count });
      onArtifactStatusRef.current?.(status);

      return () => {
        clearDemoRoom();
      };
    }, [demoMode, effectiveVersion]);

    // Load real .splat or fallback .ply artifact in live mode, preserving camera position/orientation
    useEffect(() => {
      const st = sceneObjectsRef.current;
      const artifactGroup = st.artifactGroup;
      if (!artifactGroup) return;

      const disposeActiveArtifact = () => {
        if (st.activeSplatHandle) {
          artifactGroup.remove(st.activeSplatHandle.mesh);
          st.activeSplatHandle.dispose();
          st.activeSplatHandle = undefined;
        }
        if (st.activePointCloud) {
          artifactGroup.remove(st.activePointCloud);
          st.activePointCloud.geometry.dispose();
          (st.activePointCloud.material as THREE.Material).dispose();
          st.activePointCloud = undefined;
        }
      };

      if (demoMode) {
        disposeActiveArtifact();
        return;
      }

      const targetSplatUrl =
        effectiveVersion === 'edited' ? editedSplatUrl || splatUrl || '' : splatUrl || '';
      const targetPlyUrl =
        effectiveVersion === 'edited'
          ? editedPointCloudUrl || pointCloudUrl || ''
          : pointCloudUrl || '';

      const controller = new AbortController();
      let cancelled = false;

      const applyLoadedBounds = (box: THREE.Box3) => {
        const nav = computeNavigationBounds(box, viewerTransform);
        st.navBounds = {
          boundsBox: nav.boundsBox,
          defaultCameraPos: nav.defaultCameraPos,
          defaultTarget: nav.defaultTarget,
          minRadius: nav.minRadius,
          maxRadius: nav.maxRadius,
        };
        // Only frame initial camera on first live load; version switches MUST keep exact camera
        if (!st.hasInitializedLiveCamera && st.camera) {
          st.hasInitializedLiveCamera = true;
          st.camera.position.copy(nav.defaultCameraPos);
          st.target.copy(nav.defaultTarget);
          st.camera.lookAt(st.target);
          st.spherical.setFromVector3(st.camera.position.clone().sub(st.target));
          st.flyEuler.setFromQuaternion(st.camera.quaternion, 'YXZ');
        }
      };

      const loadLiveArtifacts = async () => {
        setArtifactUiState({ mode: 'loading', errorMessage: null, gaussianCount: 0 });
        onArtifactStatusRef.current?.({ mode: 'loading', version: effectiveVersion });

        const transformMatrix = viewerTransformToMatrix4(viewerTransform);
        let splatFailureReason: string | null = null;

        if (renderMode === 'splat') {
          if (targetSplatUrl) {
            try {
              const buf = await fetchArtifactBuffer(
                targetSplatUrl,
                st.artifactCache,
                controller.signal
              );
              if (cancelled) return;
              const parsed = parseSplatBuffer(buf, { transformMatrix });
              const width = mountRef.current?.clientWidth || 960;
              const height = mountRef.current?.clientHeight || 600;
              const handle = createSplatMesh(parsed, {
                viewportWidth: width,
                viewportHeight: height,
              });
              if (st.camera) {
                handle.sortByCamera(st.camera, true);
              }
              disposeActiveArtifact();
              st.activeSplatHandle = handle;
              artifactGroup.add(handle.mesh);
              applyLoadedBounds(handle.boundingBox);

              setArtifactUiState({
                mode: 'splat',
                errorMessage: null,
                gaussianCount: parsed.count,
              });
              onArtifactStatusRef.current?.({
                mode: 'splat',
                version: effectiveVersion,
                gaussianCount: parsed.count,
              });
              return;
            } catch (err) {
              if (cancelled) return;
              splatFailureReason = err instanceof Error ? err.message : 'Failed to load .splat';
            }
          } else {
            splatFailureReason = 'No .splat artifact URL available for this scene version.';
          }
        }

        // Either renderMode === 'pointcloud' or .splat failed -> try real sparse .ply fallback
        if (targetPlyUrl) {
          try {
            const buf = await fetchArtifactBuffer(
              targetPlyUrl,
              st.artifactCache,
              controller.signal
            );
            if (cancelled) return;
            const parsedPly = parsePlyBuffer(buf, { transformMatrix });
            const pointSize = Math.max(
              0.025,
              Math.min(0.12, parsedPly.boundingBox.getSize(new THREE.Vector3()).length() * 0.008)
            );
            const points = new THREE.Points(
              parsedPly.geometry,
              new THREE.PointsMaterial({
                size: pointSize,
                map: st.splatTex,
                vertexColors: true,
                transparent: true,
                opacity: 0.94,
                depthWrite: true,
                alphaTest: 0.05,
                sizeAttenuation: true,
              })
            );
            disposeActiveArtifact();
            st.activePointCloud = points;
            artifactGroup.add(points);
            applyLoadedBounds(parsedPly.boundingBox);

            const isFallback = renderMode === 'splat' && Boolean(splatFailureReason);
            setArtifactUiState({
              mode: isFallback ? 'pointcloud_fallback' : 'splat',
              errorMessage: isFallback ? splatFailureReason : null,
              gaussianCount: parsedPly.count,
            });
            onArtifactStatusRef.current?.({
              mode: isFallback ? 'pointcloud_fallback' : 'splat',
              version: effectiveVersion,
              gaussianCount: parsedPly.count,
              errorMessage: isFallback ? splatFailureReason : null,
            });
            return;
          } catch (plyErr) {
            if (cancelled) return;
            const plyMsg = plyErr instanceof Error ? plyErr.message : 'Failed to load .ply';
            const combined = splatFailureReason
              ? `Splat load failed (${splatFailureReason}); Sparse PLY fallback also failed (${plyMsg}).`
              : `Sparse PLY load failed (${plyMsg}).`;
            disposeActiveArtifact();
            setArtifactUiState({
              mode: 'error',
              errorMessage: combined,
              gaussianCount: 0,
            });
            onArtifactStatusRef.current?.({
              mode: 'error',
              version: effectiveVersion,
              errorMessage: combined,
            });
            return;
          }
        }

        const missingMsg = splatFailureReason
          ? `${splatFailureReason} No fallback sparse .ply URL was provided.`
          : 'No 3D scene artifact URLs (.splat or .ply) were provided for this project.';
        disposeActiveArtifact();
        setArtifactUiState({
          mode: 'error',
          errorMessage: missingMsg,
          gaussianCount: 0,
        });
        onArtifactStatusRef.current?.({
          mode: 'error',
          version: effectiveVersion,
          errorMessage: missingMsg,
        });
      };

      void loadLiveArtifacts();

      return () => {
        cancelled = true;
        controller.abort();
      };
    }, [
      demoMode,
      effectiveVersion,
      splatUrl,
      pointCloudUrl,
      editedSplatUrl,
      editedPointCloudUrl,
      renderMode,
      viewerTransform,
      reloadNonce,
    ]);

    // Demo-mode renderMode toggle
    useEffect(() => {
      if (!demoMode) return;
      const st = sceneObjectsRef.current;
      if (!st.solidGroup || !st.splatPoints || !st.sparsePoints) return;
      if (renderMode === 'pointcloud') {
        st.solidGroup.visible = false;
        st.splatPoints.visible = false;
        st.sparsePoints.visible = true;
      } else {
        st.solidGroup.visible = true;
        st.splatPoints.visible = true;
        st.sparsePoints.visible = false;
      }
    }, [demoMode, renderMode]);

    useEffect(() => {
      const st = sceneObjectsRef.current;
      if (!st.sunLight) return;
      const rad = (sunAngleDeg * Math.PI) / 180;
      st.sunLight.position.set(
        Math.cos(rad) * -6.5,
        4.2 + Math.sin(rad) * 2.2,
        Math.sin(rad) * 4.5
      );
    }, [sunAngleDeg]);

    useEffect(() => {
      const st = sceneObjectsRef.current;
      if (!st.selectionHalo) return;
      const obj = objects.find((o) => o.id === selectedObjectId);
      if (obj) {
        st.selectionHalo.position.set(
          obj.worldBoundsCenter[0],
          0.025,
          obj.worldBoundsCenter[2]
        );
      }
    }, [selectedObjectId, objects]);

    useEffect(() => {
      const st = sceneObjectsRef.current;
      for (const [id, entry] of Object.entries(st.furnitureMaterials)) {
        const override = !showOriginalScene ? objectOverrides[id] : undefined;
        entry.mat.color.set(override ? override.colorHex : entry.originalHex);
      }
    }, [objectOverrides, showOriginalScene]);

    const handleRetryLoad = () => {
      sceneObjectsRef.current.artifactCache.clear();
      setReloadNonce((n) => n + 1);
    };

    if (webglUnavailable) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-surface-container-low to-surface-container p-8 text-center">
          <span className="material-symbols-outlined text-4xl text-primary mb-2">
            view_in_ar
          </span>
          <h3 className="font-headline text-2xl text-on-surface">
            WebGL Context Unavailable
          </h3>
          <p className="text-xs text-on-surface-variant max-w-md mt-2">
            WebGL hardware acceleration is unavailable in this browser context. Reference frame
            picking and 2D mask editing remain fully active.
          </p>
        </div>
      );
    }

    return (
      <div className="relative w-full h-full">
        <div
          ref={mountRef}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          aria-label="Interactive 3D Room Splat Viewport"
        />

        {!demoMode && artifactUiState.mode === 'loading' && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center bg-surface-container-low/55 backdrop-blur-xs">
            <div className="px-4 py-2.5 rounded-2xl bg-white/95 border border-border-sand shadow-lg flex items-center gap-2.5 text-xs font-semibold text-on-surface">
              <span className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <span>Loading {effectiveVersion} 3D scene artifact...</span>
            </div>
          </div>
        )}

        {!demoMode && artifactUiState.mode === 'pointcloud_fallback' && (
          <div
            role="status"
            className="absolute bottom-5 left-5 z-20 px-3.5 py-2 rounded-2xl bg-amber-50/95 border border-amber-300/80 shadow-md flex items-center gap-2 text-xs text-amber-950"
          >
            <span className="material-symbols-outlined text-[16px] text-amber-700">
              grain
            </span>
            <span className="font-semibold">
              Sparse Point Cloud Fallback — splat unavailable
            </span>
            <span className="text-[11px] text-amber-800/80">
              ({artifactUiState.gaussianCount.toLocaleString()} pts)
            </span>
          </div>
        )}

        {!demoMode && artifactUiState.mode === 'error' && (
          <div
            role="alert"
            className="absolute inset-0 z-20 flex items-center justify-center bg-surface-container-low/90 backdrop-blur-sm p-6"
          >
            <div className="max-w-md w-full rounded-3xl bg-white border border-error/30 shadow-xl p-6 text-center flex flex-col items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-error/10 text-error flex items-center justify-center">
                <span className="material-symbols-outlined text-2xl">error_outline</span>
              </div>
              <h3 className="font-headline text-xl font-semibold text-on-surface">
                Unable to Load 3D Scene Artifact
              </h3>
              <p className="text-xs text-on-surface-variant leading-relaxed break-words">
                {artifactUiState.errorMessage ||
                  'Both the Gaussian splat (.splat) and sparse point cloud (.ply) failed to load.'}
              </p>
              <button
                type="button"
                onClick={handleRetryLoad}
                className="mt-1 px-4 py-2 rounded-xl bg-primary-deep hover:bg-primary-container-deep text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                <span>Retry Artifact Load</span>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }
);

SplatRoomViewport.displayName = 'SplatRoomViewport';
