import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  SPLAT_BYTES_PER_GAUSSIAN,
  SplatParseError,
  PlyParseError,
  colmapExtrinsicsToThreePose,
  computeNavigationBounds,
  createSplatMesh,
  parsePlyBuffer,
  parseSplatBuffer,
  viewerTransformToMatrix4,
} from '../loaders/index.ts';

/**
 * Helper: build a real Antimatter15 32-byte-per-Gaussian binary `.splat` ArrayBuffer.
 */
function buildBinarySplat(gaussians) {
  const buf = new ArrayBuffer(gaussians.length * SPLAT_BYTES_PER_GAUSSIAN);
  const view = new DataView(buf);
  for (let i = 0; i < gaussians.length; i++) {
    const g = gaussians[i];
    const base = i * SPLAT_BYTES_PER_GAUSSIAN;
    view.setFloat32(base + 0, g.pos[0], true);
    view.setFloat32(base + 4, g.pos[1], true);
    view.setFloat32(base + 8, g.pos[2], true);
    view.setFloat32(base + 12, g.scale[0], true);
    view.setFloat32(base + 16, g.scale[1], true);
    view.setFloat32(base + 20, g.scale[2], true);
    view.setUint8(base + 24, g.rgba[0]);
    view.setUint8(base + 25, g.rgba[1]);
    view.setUint8(base + 26, g.rgba[2]);
    view.setUint8(base + 27, g.rgba[3]);
    // Encode quaternion (qw, qx, qy, qz) -> clamp(round(q * 128 + 128), 0, 255)
    for (let k = 0; k < 4; k++) {
      const encoded = Math.min(255, Math.max(0, Math.round(g.quatWxyz[k] * 128 + 128)));
      view.setUint8(base + 28 + k, encoded);
    }
  }
  return buf;
}

/**
 * Helper: build a binary little-endian `.ply` buffer with (x, y, z, red, green, blue).
 */
function buildBinaryRgbPly(points, crlf = false) {
  const nl = crlf ? '\r\n' : '\n';
  const header = [
    'ply',
    'format binary_little_endian 1.0',
    `element vertex ${points.length}`,
    'property float x',
    'property float y',
    'property float z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    'end_header',
    '',
  ].join(nl);
  const headerBytes = new TextEncoder().encode(header);
  const stride = 15; // 3 * float32 + 3 * uint8
  const buf = new ArrayBuffer(headerBytes.byteLength + points.length * stride);
  new Uint8Array(buf, 0, headerBytes.byteLength).set(headerBytes);
  const view = new DataView(buf, headerBytes.byteLength);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const off = i * stride;
    view.setFloat32(off + 0, p.pos[0], true);
    view.setFloat32(off + 4, p.pos[1], true);
    view.setFloat32(off + 8, p.pos[2], true);
    view.setUint8(off + 12, p.rgb[0]);
    view.setUint8(off + 13, p.rgb[1]);
    view.setUint8(off + 14, p.rgb[2]);
  }
  return buf;
}

/**
 * Helper: build a binary little-endian 3DGS `.ply` with f_dc_0..2.
 */
function buildBinaryShDcPly(points) {
  const header = [
    'ply',
    'format binary_little_endian 1.0',
    `element vertex ${points.length}`,
    'property float x',
    'property float y',
    'property float z',
    'property float f_dc_0',
    'property float f_dc_1',
    'property float f_dc_2',
    'end_header',
    '',
  ].join('\n');
  const headerBytes = new TextEncoder().encode(header);
  const stride = 24; // 6 * float32
  const buf = new ArrayBuffer(headerBytes.byteLength + points.length * stride);
  new Uint8Array(buf, 0, headerBytes.byteLength).set(headerBytes);
  const view = new DataView(buf, headerBytes.byteLength);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const off = i * stride;
    view.setFloat32(off + 0, p.pos[0], true);
    view.setFloat32(off + 4, p.pos[1], true);
    view.setFloat32(off + 8, p.pos[2], true);
    view.setFloat32(off + 12, p.fdc[0], true);
    view.setFloat32(off + 16, p.fdc[1], true);
    view.setFloat32(off + 20, p.fdc[2], true);
  }
  return buf;
}

test('parseSplatBuffer parses 32-byte Antimatter15 binary payload and computes Box3', () => {
  const buf = buildBinarySplat([
    { pos: [1.5, -2.0, 3.0], scale: [0.1, 0.2, 0.3], rgba: [255, 128, 0, 200], quatWxyz: [1, 0, 0, 0] },
    { pos: [-1.0, 0.5, -4.0], scale: [0.05, 0.05, 0.05], rgba: [10, 20, 30, 255], quatWxyz: [0.7071, 0.7071, 0, 0] },
  ]);

  const parsed = parseSplatBuffer(buf);
  assert.equal(parsed.count, 2);
  assert.equal(parsed.byteLength, 64);
  assert.equal(parsed.skippedInvalidCount, 0);

  assert.deepEqual(Array.from(parsed.positions), [1.5, -2.0, 3.0, -1.0, 0.5, -4.0]);
  assert.ok(Math.abs(parsed.scales[0] - 0.1) < 1e-6);
  assert.ok(Math.abs(parsed.colors[0] - 1.0) < 1e-6);
  assert.ok(Math.abs(parsed.colors[1] - 128 / 255) < 1e-4);
  assert.ok(Math.abs(parsed.colors[3] - 200 / 255) < 1e-4);

  // Quaternion stored in Three.js (x, y, z, w) order and unit-normalized
  const qLen0 = Math.hypot(
    parsed.quaternions[0],
    parsed.quaternions[1],
    parsed.quaternions[2],
    parsed.quaternions[3]
  );
  assert.ok(Math.abs(qLen0 - 1) < 1e-4);
  assert.ok(Math.abs(parsed.quaternions[3] - 1) < 0.02); // qw ~ 1

  assert.deepEqual(parsed.boundingBox.min.toArray(), [-1.0, -2.0, -4.0]);
  assert.deepEqual(parsed.boundingBox.max.toArray(), [1.5, 0.5, 3.0]);
});

test('parseSplatBuffer applies COLMAP -> Three.js transformMatrix accurately', () => {
  const buf = buildBinarySplat([
    { pos: [1.2, 2.0, 3.5], scale: [0.1, 0.2, 0.3], rgba: [200, 150, 100, 255], quatWxyz: [1, 0, 0, 0] },
  ]);
  const colmapToThree = viewerTransformToMatrix4();
  const parsed = parseSplatBuffer(buf, { transformMatrix: colmapToThree });

  assert.equal(parsed.count, 1);
  assert.ok(Math.abs(parsed.positions[0] - 1.2) < 1e-6);
  assert.ok(Math.abs(parsed.positions[1] - -2.0) < 1e-6);
  assert.ok(Math.abs(parsed.positions[2] - -3.5) < 1e-6);
  assert.ok(Math.abs(parsed.boundingBox.min.x - 1.2) < 1e-6);
  assert.ok(Math.abs(parsed.boundingBox.min.y - -2.0) < 1e-6);
  assert.ok(Math.abs(parsed.boundingBox.min.z - -3.5) < 1e-6);
});

test('parseSplatBuffer rejects empty, truncated, misaligned, and all-invalid buffers', () => {
  assert.throws(() => parseSplatBuffer(new ArrayBuffer(0)), SplatParseError);
  assert.throws(() => parseSplatBuffer(new ArrayBuffer(16)), SplatParseError);
  assert.throws(() => parseSplatBuffer(new ArrayBuffer(40)), SplatParseError);

  const badBuf = buildBinarySplat([
    { pos: [Number.NaN, 0, 0], scale: [0.1, 0.1, 0.1], rgba: [255, 255, 255, 255], quatWxyz: [1, 0, 0, 0] },
    { pos: [0, 0, 0], scale: [-0.1, 0.1, 0.1], rgba: [255, 255, 255, 255], quatWxyz: [1, 0, 0, 0] },
  ]);
  assert.throws(() => parseSplatBuffer(badBuf), SplatParseError);
});

test('parsePlyBuffer parses ASCII PLY with CRLF and computes BufferGeometry + Box3', () => {
  const ascii = [
    'ply',
    'format ascii 1.0',
    'comment sparse test',
    'element vertex 2',
    'property float x',
    'property float y',
    'property float z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    'end_header',
    '0.0 1.0 2.0 255 0 128',
    '-3.0 -1.5 4.0 0 255 64',
    '',
  ].join('\r\n');
  const buf = new TextEncoder().encode(ascii).buffer;
  const parsed = parsePlyBuffer(buf);

  assert.equal(parsed.format, 'ascii');
  assert.equal(parsed.count, 2);
  assert.ok(parsed.geometry.getAttribute('position'));
  assert.ok(parsed.geometry.getAttribute('color'));
  assert.deepEqual(parsed.boundingBox.min.toArray(), [-3.0, -1.5, 2.0]);
  assert.deepEqual(parsed.boundingBox.max.toArray(), [0.0, 1.0, 4.0]);
  assert.ok(Math.abs(parsed.colors[0] - 1.0) < 1e-6);
  assert.ok(Math.abs(parsed.colors[4] - 1.0) < 1e-6);
  parsed.geometry.dispose();
});

test('parsePlyBuffer parses binary little-endian RGB PLY and 3DGS f_dc PLY', () => {
  const colmapToThree = viewerTransformToMatrix4();
  const rgbBuf = buildBinaryRgbPly(
    [
      { pos: [2.0, 1.0, 4.0], rgb: [200, 100, 50] },
      { pos: [-1.0, -2.0, 1.5], rgb: [10, 20, 30] },
    ],
    true
  );
  const parsedRgb = parsePlyBuffer(rgbBuf, { transformMatrix: colmapToThree });
  assert.equal(parsedRgb.format, 'binary_little_endian');
  assert.equal(parsedRgb.count, 2);
  assert.ok(Math.abs(parsedRgb.positions[0] - 2.0) < 1e-6);
  assert.ok(Math.abs(parsedRgb.positions[1] - -1.0) < 1e-6);
  assert.ok(Math.abs(parsedRgb.positions[2] - -4.0) < 1e-6);
  parsedRgb.geometry.dispose();

  const shBuf = buildBinaryShDcPly([
    { pos: [0, 0, 1], fdc: [0, 1.77245385, -1.77245385] },
  ]);
  const parsedSh = parsePlyBuffer(shBuf);
  assert.equal(parsedSh.count, 1);
  assert.ok(Math.abs(parsedSh.colors[0] - 0.5) < 1e-4);
  assert.ok(Math.abs(parsedSh.colors[1] - 1.0) < 1e-4);
  assert.ok(Math.abs(parsedSh.colors[2] - 0.0) < 1e-4);
  parsedSh.geometry.dispose();
});

test('parsePlyBuffer rejects malformed and truncated PLY payloads', () => {
  assert.throws(() => parsePlyBuffer(new ArrayBuffer(0)), PlyParseError);
  assert.throws(() => parsePlyBuffer(new TextEncoder().encode('not a ply').buffer), PlyParseError);
  assert.throws(
    () =>
      parsePlyBuffer(
        new TextEncoder().encode('ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nend_header\n1 2\n').buffer
      ),
    PlyParseError
  );
  const truncatedBin = buildBinaryRgbPly([{ pos: [1, 2, 3], rgb: [10, 20, 30] }]).slice(0, -4);
  assert.throws(() => parsePlyBuffer(truncatedBin), PlyParseError);
});

test('COLMAP extrinsics -> Three.js camera projection matches COLMAP pinhole projection', () => {
  const width = 960;
  const height = 540;
  const fx = 720;
  const fy = 720;
  const cx = width / 2;
  const cy = height / 2;

  // Non-trivial COLMAP world-to-camera pose: rotated slightly around Y and translated
  const qW2C = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, -0.35, 0.05, 'XYZ')).normalize();
  const qvecWxyz = [qW2C.w, qW2C.x, qW2C.y, qW2C.z];
  const tvecXyz = [0.4, -0.2, 3.2];

  // World point in COLMAP coords (+X right, +Y down, +Z forward)
  const worldColmap = new THREE.Vector3(-0.35, 0.25, 1.1);
  const xCam = worldColmap.clone().applyQuaternion(qW2C).add(new THREE.Vector3(...tvecXyz));
  assert.ok(xCam.z > 0, 'Point must be in front of COLMAP camera');

  const uColmap = fx * (xCam.x / xCam.z) + cx;
  const vColmap = fy * (xCam.y / xCam.z) + cy;

  const vtMat = viewerTransformToMatrix4();
  const threePose = colmapExtrinsicsToThreePose(qvecWxyz, tvecXyz, { height, fy });
  const camera = new THREE.PerspectiveCamera(threePose.fov, width / height, 0.05, 100);
  camera.position.set(...threePose.position);
  camera.up.set(...threePose.up);
  camera.lookAt(new THREE.Vector3(...threePose.target));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const worldThree = worldColmap.clone().applyMatrix4(vtMat);
  const ndc = worldThree.project(camera);
  const uThree = (ndc.x + 1) * 0.5 * width;
  const vThree = (1 - ndc.y) * 0.5 * height;

  assert.ok(Math.abs(uThree - uColmap) < 1e-3, `u mismatch: ${uThree} vs ${uColmap}`);
  assert.ok(Math.abs(vThree - vColmap) < 1e-3, `v mismatch: ${vThree} vs ${vColmap}`);
});

test('createSplatMesh sorts Gaussians back-to-front by camera depth and computeNavigationBounds derives Box3 bounds', () => {
  const buf = buildBinarySplat([
    { pos: [0, 0, -1], scale: [0.1, 0.1, 0.1], rgba: [255, 0, 0, 255], quatWxyz: [1, 0, 0, 0] },
    { pos: [0, 0, -5], scale: [0.1, 0.1, 0.1], rgba: [0, 255, 0, 255], quatWxyz: [1, 0, 0, 0] },
    { pos: [0, 0, -3], scale: [0.1, 0.1, 0.1], rgba: [0, 0, 255, 255], quatWxyz: [1, 0, 0, 0] },
  ]);
  const parsed = parseSplatBuffer(buf);
  const handle = createSplatMesh(parsed, { viewportWidth: 800, viewportHeight: 600 });

  const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 100);
  camera.position.set(0, 0, 2);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld(true);

  handle.sortByCamera(camera, true);
  const centers = handle.mesh.geometry.getAttribute('aCenter');
  // Back-to-front: z=-5 first, z=-3 second, z=-1 last
  assert.equal(centers.getZ(0), -5);
  assert.equal(centers.getZ(1), -3);
  assert.equal(centers.getZ(2), -1);

  const nav = computeNavigationBounds(handle.boundingBox);
  assert.ok(nav.boundsBox.containsBox(handle.boundingBox));
  assert.ok(nav.minRadius > 0 && nav.maxRadius > nav.minRadius);
  handle.dispose();
});
