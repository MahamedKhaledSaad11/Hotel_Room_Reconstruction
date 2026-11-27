import * as THREE from 'three';
import { decomposeRigidTransform } from './viewerTransform.ts';

export const SPLAT_BYTES_PER_GAUSSIAN = 32;

export class SplatParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SplatParseError';
  }
}

export interface ParsedSplatData {
  count: number;
  byteLength: number;
  /** Interleaved XYZ positions in output coordinate space (length = count * 3) */
  positions: Float32Array;
  /** Linear Gaussian scales (sx, sy, sz) (length = count * 3) */
  scales: Float32Array;
  /** Normalized RGBA colors in [0, 1] (length = count * 4) */
  colors: Float32Array;
  /** Normalized quaternions in Three.js (x, y, z, w) order (length = count * 4) */
  quaternions: Float32Array;
  /** Axis-aligned bounding box of all valid Gaussian centers */
  boundingBox: THREE.Box3;
  /** Number of Gaussians skipped due to NaN/Infinity values */
  skippedInvalidCount: number;
}

export interface ParseSplatOptions {
  /** Optional 4x4 transform applied to positions and rotations (e.g. COLMAP -> Three.js). */
  transformMatrix?: THREE.Matrix4;
}

/**
 * Parses a standard Antimatter15 32-byte-per-Gaussian binary `.splat` buffer:
 * - bytes 0..11:  float32[3] position (x, y, z)
 * - bytes 12..23: float32[3] scale (sx, sy, sz)
 * - bytes 24..27: uint8[4]   color & alpha (r, g, b, a)
 * - bytes 28..31: uint8[4]   encoded quaternion (qw, qx, qy, qz) -> (byte - 128) / 128
 */
export function parseSplatBuffer(
  buffer: ArrayBuffer,
  options: ParseSplatOptions = {}
): ParsedSplatData {
  if (!(buffer instanceof ArrayBuffer)) {
    throw new SplatParseError('Expected an ArrayBuffer for .splat parsing.');
  }
  if (buffer.byteLength === 0) {
    throw new SplatParseError('Empty .splat buffer (0 bytes).');
  }
  if (buffer.byteLength < SPLAT_BYTES_PER_GAUSSIAN) {
    throw new SplatParseError(
      `Truncated .splat buffer: ${buffer.byteLength} bytes (< ${SPLAT_BYTES_PER_GAUSSIAN} bytes).`
    );
  }
  if (buffer.byteLength % SPLAT_BYTES_PER_GAUSSIAN !== 0) {
    throw new SplatParseError(
      `Malformed .splat buffer length ${buffer.byteLength}: not a multiple of ${SPLAT_BYTES_PER_GAUSSIAN} bytes.`
    );
  }

  const rawCount = buffer.byteLength / SPLAT_BYTES_PER_GAUSSIAN;
  const view = new DataView(buffer);

  const positions = new Float32Array(rawCount * 3);
  const scales = new Float32Array(rawCount * 3);
  const colors = new Float32Array(rawCount * 4);
  const quaternions = new Float32Array(rawCount * 4);

  const hasTransform = Boolean(options.transformMatrix);
  const transformMat = options.transformMatrix ?? new THREE.Matrix4();
  const { quaternion: qTransform, scale: uniformScale } = hasTransform
    ? decomposeRigidTransform(transformMat)
    : { quaternion: new THREE.Quaternion(), scale: 1 };

  const tmpVec = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const boundingBox = new THREE.Box3();

  let validCount = 0;
  let skippedInvalidCount = 0;

  for (let i = 0; i < rawCount; i++) {
    const byteOffset = i * SPLAT_BYTES_PER_GAUSSIAN;

    const px = view.getFloat32(byteOffset + 0, true);
    const py = view.getFloat32(byteOffset + 4, true);
    const pz = view.getFloat32(byteOffset + 8, true);

    const sx = view.getFloat32(byteOffset + 12, true);
    const sy = view.getFloat32(byteOffset + 16, true);
    const sz = view.getFloat32(byteOffset + 20, true);

    if (
      !Number.isFinite(px) ||
      !Number.isFinite(py) ||
      !Number.isFinite(pz) ||
      !Number.isFinite(sx) ||
      !Number.isFinite(sy) ||
      !Number.isFinite(sz) ||
      sx < 0 ||
      sy < 0 ||
      sz < 0
    ) {
      skippedInvalidCount++;
      continue;
    }

    const r = view.getUint8(byteOffset + 24) / 255;
    const g = view.getUint8(byteOffset + 25) / 255;
    const b = view.getUint8(byteOffset + 26) / 255;
    const a = view.getUint8(byteOffset + 27) / 255;

    // Antimatter15 stores quaternion in (qw, qx, qy, qz) byte order
    const qwRaw = (view.getUint8(byteOffset + 28) - 128) / 128;
    const qxRaw = (view.getUint8(byteOffset + 29) - 128) / 128;
    const qyRaw = (view.getUint8(byteOffset + 30) - 128) / 128;
    const qzRaw = (view.getUint8(byteOffset + 31) - 128) / 128;

    tmpQuat.set(qxRaw, qyRaw, qzRaw, qwRaw);
    if (tmpQuat.lengthSq() < 1e-10) {
      tmpQuat.set(0, 0, 0, 1);
    } else {
      tmpQuat.normalize();
    }

    tmpVec.set(px, py, pz);
    if (hasTransform) {
      tmpVec.applyMatrix4(transformMat);
      tmpQuat.premultiply(qTransform).normalize();
    }

    const pIdx = validCount * 3;
    positions[pIdx + 0] = tmpVec.x;
    positions[pIdx + 1] = tmpVec.y;
    positions[pIdx + 2] = tmpVec.z;

    scales[pIdx + 0] = sx * uniformScale;
    scales[pIdx + 1] = sy * uniformScale;
    scales[pIdx + 2] = sz * uniformScale;

    const cIdx = validCount * 4;
    colors[cIdx + 0] = r;
    colors[cIdx + 1] = g;
    colors[cIdx + 2] = b;
    colors[cIdx + 3] = a;

    quaternions[cIdx + 0] = tmpQuat.x;
    quaternions[cIdx + 1] = tmpQuat.y;
    quaternions[cIdx + 2] = tmpQuat.z;
    quaternions[cIdx + 3] = tmpQuat.w;

    boundingBox.expandByPoint(tmpVec);
    validCount++;
  }

  if (validCount === 0) {
    throw new SplatParseError('No valid finite Gaussians found in .splat buffer.');
  }

  return {
    count: validCount,
    byteLength: buffer.byteLength,
    positions: validCount === rawCount ? positions : positions.subarray(0, validCount * 3),
    scales: validCount === rawCount ? scales : scales.subarray(0, validCount * 3),
    colors: validCount === rawCount ? colors : colors.subarray(0, validCount * 4),
    quaternions: validCount === rawCount ? quaternions : quaternions.subarray(0, validCount * 4),
    boundingBox,
    skippedInvalidCount,
  };
}

const SPLAT_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec3 aScale;
  attribute vec4 aColor;
  attribute vec4 aQuat;

  uniform vec2 uViewport;
  uniform float uMaxSplatRadiusPx;

  varying vec4 vColor;
  varying vec2 vSigmaCoord;

  mat3 quatToMat3(vec4 q) {
    float x = q.x;
    float y = q.y;
    float z = q.z;
    float w = q.w;
    float xx = x * x;
    float yy = y * y;
    float zz = z * z;
    float xy = x * y;
    float xz = x * z;
    float yz = y * z;
    float wx = w * x;
    float wy = w * y;
    float wz = w * z;
    return mat3(
      1.0 - 2.0 * (yy + zz), 2.0 * (xy + wz),       2.0 * (xz - wy),
      2.0 * (xy - wz),       1.0 - 2.0 * (xx + zz), 2.0 * (yz + wx),
      2.0 * (xz + wy),       2.0 * (yz - wx),       1.0 - 2.0 * (xx + yy)
    );
  }

  void main() {
    vColor = aColor;
    vSigmaCoord = position.xy * 2.6;

    if (aColor.a <= 0.004) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      return;
    }

    vec4 cam = modelViewMatrix * vec4(aCenter, 1.0);
    if (cam.z >= -0.08) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      return;
    }

    mat3 R = quatToMat3(normalize(aQuat));
    mat3 M = mat3(
      R[0] * aScale.x,
      R[1] * aScale.y,
      R[2] * aScale.z
    );

    float fx = projectionMatrix[0][0] * uViewport.x * 0.5;
    float fy = projectionMatrix[1][1] * uViewport.y * 0.5;
    float invZ = 1.0 / (-cam.z);
    float invZ2 = invZ * invZ;

    mat3 W = mat3(modelViewMatrix);
    vec3 jw0 = vec3(fx * invZ, 0.0, fx * cam.x * invZ2) * W;
    vec3 jw1 = vec3(0.0, fy * invZ, fy * cam.y * invZ2) * W;

    vec3 t0 = jw0 * M;
    vec3 t1 = jw1 * M;

    float a = dot(t0, t0) + 0.35;
    float b = dot(t0, t1);
    float c = dot(t1, t1) + 0.35;

    float mid = 0.5 * (a + c);
    float disc = sqrt(max(0.0, 0.25 * (a - c) * (a - c) + b * b));
    float lambda1 = mid + disc;
    float lambda2 = max(0.1, mid - disc);

    vec2 eig1;
    if (abs(b) > 1e-6) {
      eig1 = a >= c ? normalize(vec2(lambda1 - c, b)) : normalize(vec2(b, lambda1 - a));
    } else {
      eig1 = a >= c ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    }
    vec2 eig2 = vec2(-eig1.y, eig1.x);

    float r1 = min(uMaxSplatRadiusPx, sqrt(lambda1));
    float r2 = min(uMaxSplatRadiusPx, sqrt(lambda2));
    vec2 offsetPx = (position.x * r1 * eig1 + position.y * r2 * eig2) * 2.6;

    vec4 clipCenter = projectionMatrix * cam;
    gl_Position = clipCenter;
    gl_Position.xy += (offsetPx / max(vec2(1.0), 0.5 * uViewport)) * clipCenter.w;
  }
`;

const SPLAT_FRAGMENT_SHADER = /* glsl */ `
  varying vec4 vColor;
  varying vec2 vSigmaCoord;

  void main() {
    float r2 = dot(vSigmaCoord, vSigmaCoord);
    if (r2 > 6.76) discard;
    float alpha = exp(-0.5 * r2) * vColor.a;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(vColor.rgb, alpha);
  }
`;

export interface SplatRenderHandle {
  mesh: THREE.Mesh;
  boundingBox: THREE.Box3;
  count: number;
  sortByCamera: (camera: THREE.Camera, force?: boolean) => void;
  setViewportSize: (width: number, height: number) => void;
  dispose: () => void;
}

/**
 * Builds an instanced Three.js Gaussian splat mesh with EWA covariance projection
 * and back-to-front 16-bit counting sort for depth-aware alpha blending.
 */
export function createSplatMesh(
  data: ParsedSplatData,
  options: { maxSplatRadiusPx?: number; viewportWidth?: number; viewportHeight?: number } = {}
): SplatRenderHandle {
  const count = data.count;

  const geometry = new THREE.InstancedBufferGeometry();
  const basePositions = new Float32Array([
    -1, -1, 0,
     1, -1, 0,
     1,  1, 0,
    -1,  1, 0,
  ]);
  geometry.setAttribute('position', new THREE.BufferAttribute(basePositions, 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.instanceCount = count;

  const sortedCenters = new Float32Array(data.positions);
  const sortedScales = new Float32Array(data.scales);
  const sortedColors = new Float32Array(data.colors);
  const sortedQuats = new Float32Array(data.quaternions);

  const centerAttr = new THREE.InstancedBufferAttribute(sortedCenters, 3);
  const scaleAttr = new THREE.InstancedBufferAttribute(sortedScales, 3);
  const colorAttr = new THREE.InstancedBufferAttribute(sortedColors, 4);
  const quatAttr = new THREE.InstancedBufferAttribute(sortedQuats, 4);

  centerAttr.setUsage(THREE.DynamicDrawUsage);
  scaleAttr.setUsage(THREE.DynamicDrawUsage);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  quatAttr.setUsage(THREE.DynamicDrawUsage);

  geometry.setAttribute('aCenter', centerAttr);
  geometry.setAttribute('aScale', scaleAttr);
  geometry.setAttribute('aColor', colorAttr);
  geometry.setAttribute('aQuat', quatAttr);

  geometry.boundingBox = data.boundingBox.clone();
  geometry.boundingSphere = data.boundingBox.getBoundingSphere(new THREE.Sphere());

  const material = new THREE.ShaderMaterial({
    vertexShader: SPLAT_VERTEX_SHADER,
    fragmentShader: SPLAT_FRAGMENT_SHADER,
    uniforms: {
      uViewport: {
        value: new THREE.Vector2(
          options.viewportWidth ?? 960,
          options.viewportHeight ?? 600
        ),
      },
      uMaxSplatRadiusPx: {
        value: options.maxSplatRadiusPx ?? 240,
      },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  // Pre-allocated scratch buffers for O(N) back-to-front 16-bit counting sort
  const BUCKETS = 65536;
  const counts = new Uint32Array(BUCKETS);
  const depths = new Float32Array(count);
  const sortedIndices = new Uint32Array(count);

  const lastCamPos = new THREE.Vector3(Infinity, Infinity, Infinity);
  const lastCamDir = new THREE.Vector3(0, 0, -1);
  const curCamPos = new THREE.Vector3();
  const curCamDir = new THREE.Vector3();

  const sortByCamera = (camera: THREE.Camera, force = false) => {
    if (count <= 1) return;

    camera.getWorldPosition(curCamPos);
    camera.getWorldDirection(curCamDir);

    if (
      !force &&
      lastCamPos.distanceToSquared(curCamPos) < 0.001 &&
      lastCamDir.dot(curCamDir) > 0.9992
    ) {
      return;
    }

    lastCamPos.copy(curCamPos);
    lastCamDir.copy(curCamDir);

    camera.updateMatrixWorld();
    const m = camera.matrixWorldInverse.elements;
    const m2 = m[2];
    const m6 = m[6];
    const m10 = m[10];
    const m14 = m[14];

    let minZ = Infinity;
    let maxZ = -Infinity;
    const srcPos = data.positions;

    for (let i = 0; i < count; i++) {
      const p = i * 3;
      const z = m2 * srcPos[p] + m6 * srcPos[p + 1] + m10 * srcPos[p + 2] + m14;
      depths[i] = z;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    const span = maxZ - minZ;
    if (!(span > 1e-6)) return;

    counts.fill(0);
    const scale = (BUCKETS - 1) / span;
    for (let i = 0; i < count; i++) {
      const bucket = Math.min(BUCKETS - 1, Math.max(0, ((depths[i] - minZ) * scale) | 0));
      counts[bucket]++;
    }

    let offset = 0;
    for (let b = 0; b < BUCKETS; b++) {
      const c = counts[b];
      counts[b] = offset;
      offset += c;
    }

    for (let i = 0; i < count; i++) {
      const bucket = Math.min(BUCKETS - 1, Math.max(0, ((depths[i] - minZ) * scale) | 0));
      sortedIndices[counts[bucket]++] = i;
    }

    const srcScales = data.scales;
    const srcColors = data.colors;
    const srcQuats = data.quaternions;

    for (let dst = 0; dst < count; dst++) {
      const src = sortedIndices[dst];
      const dst3 = dst * 3;
      const src3 = src * 3;
      sortedCenters[dst3] = srcPos[src3];
      sortedCenters[dst3 + 1] = srcPos[src3 + 1];
      sortedCenters[dst3 + 2] = srcPos[src3 + 2];

      sortedScales[dst3] = srcScales[src3];
      sortedScales[dst3 + 1] = srcScales[src3 + 1];
      sortedScales[dst3 + 2] = srcScales[src3 + 2];

      const dst4 = dst * 4;
      const src4 = src * 4;
      sortedColors[dst4] = srcColors[src4];
      sortedColors[dst4 + 1] = srcColors[src4 + 1];
      sortedColors[dst4 + 2] = srcColors[src4 + 2];
      sortedColors[dst4 + 3] = srcColors[src4 + 3];

      sortedQuats[dst4] = srcQuats[src4];
      sortedQuats[dst4 + 1] = srcQuats[src4 + 1];
      sortedQuats[dst4 + 2] = srcQuats[src4 + 2];
      sortedQuats[dst4 + 3] = srcQuats[src4 + 3];
    }

    centerAttr.needsUpdate = true;
    scaleAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    quatAttr.needsUpdate = true;
  };

  return {
    mesh,
    boundingBox: data.boundingBox.clone(),
    count,
    sortByCamera,
    setViewportSize: (width: number, height: number) => {
      material.uniforms.uViewport.value.set(Math.max(1, width), Math.max(1, height));
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
