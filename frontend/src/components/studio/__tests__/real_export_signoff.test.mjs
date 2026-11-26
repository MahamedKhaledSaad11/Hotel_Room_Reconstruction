import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

import {
  colmapExtrinsicsToThreePose,
  computeNavigationBounds,
  createSplatMesh,
  parsePlyBuffer,
  parseSplatBuffer,
  viewerTransformToMatrix4,
} from '../loaders/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const TRAINING_OUT = path.join(REPO_ROOT, 'fixtures', 'room_fixture', 'training_out');

function toArrayBuffer(nodeBuffer) {
  return nodeBuffer.buffer.slice(
    nodeBuffer.byteOffset,
    nodeBuffer.byteOffset + nodeBuffer.byteLength
  );
}

function loadRunManifest() {
  const manifestPath = path.join(TRAINING_OUT, 'run_manifest.json');
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const vtRaw = raw.viewer_transform;
  const viewerTransform = {
    colmapToThreejsMatrix: vtRaw.colmap_to_threejs_matrix,
    sceneBoundsMin: vtRaw.scene_bounds_min,
    sceneBoundsMax: vtRaw.scene_bounds_max,
  };
  return { raw, viewerTransform };
}

test('Stage 2 Sign-off: splatLoader parses real A4 scene.splat with valid Gaussians, Box3, and finite RGBA', () => {
  const { viewerTransform } = loadRunManifest();
  const splatPath = path.join(TRAINING_OUT, 'scene.splat');
  const buf = toArrayBuffer(fs.readFileSync(splatPath));
  const transformMatrix = viewerTransformToMatrix4(viewerTransform);

  const parsed = parseSplatBuffer(buf, { transformMatrix });
  assert.ok(parsed.count > 0, `Expected Gaussian count > 0, got ${parsed.count}`);
  assert.equal(parsed.skippedInvalidCount, 0);
  assert.ok(!parsed.boundingBox.isEmpty(), 'Bounding box must not be empty');

  for (const v of [...parsed.boundingBox.min.toArray(), ...parsed.boundingBox.max.toArray()]) {
    assert.ok(Number.isFinite(v), `Non-finite bounding box value: ${v}`);
  }

  let nonZeroAlpha = 0;
  for (let i = 0; i < parsed.colors.length; i++) {
    const c = parsed.colors[i];
    assert.ok(Number.isFinite(c) && c >= 0 && c <= 1, `Invalid color/opacity channel: ${c}`);
    if (i % 4 === 3 && c > 0.01) nonZeroAlpha++;
  }
  assert.ok(nonZeroAlpha > 0, 'Expected Gaussians with non-zero opacity');

  const handle = createSplatMesh(parsed, { viewportWidth: 960, viewportHeight: 540 });
  const nav = computeNavigationBounds(handle.boundingBox, viewerTransform);
  assert.ok(nav.boundsBox.containsBox(handle.boundingBox));
  assert.ok(Number.isFinite(nav.radius) && nav.radius > 0);
  handle.dispose();
});

test('Stage 2 Sign-off: plyLoader parses real A4 sparse_points.ply and scene.ply with finite Box3 and colors', () => {
  const { viewerTransform } = loadRunManifest();
  const transformMatrix = viewerTransformToMatrix4(viewerTransform);

  const sparsePath = path.join(TRAINING_OUT, 'sparse_points.ply');
  const sparseBuf = toArrayBuffer(fs.readFileSync(sparsePath));
  const parsedSparse = parsePlyBuffer(sparseBuf, { transformMatrix });

  assert.ok(parsedSparse.count > 0, `Expected sparse points > 0, got ${parsedSparse.count}`);
  assert.equal(parsedSparse.skippedInvalidCount, 0);
  assert.ok(!parsedSparse.boundingBox.isEmpty());
  for (const v of [
    ...parsedSparse.boundingBox.min.toArray(),
    ...parsedSparse.boundingBox.max.toArray(),
  ]) {
    assert.ok(Number.isFinite(v), `Non-finite sparse Box3 coordinate: ${v}`);
  }
  for (let i = 0; i < parsedSparse.colors.length; i++) {
    const c = parsedSparse.colors[i];
    assert.ok(Number.isFinite(c) && c >= 0 && c <= 1, `Invalid sparse color: ${c}`);
  }
  parsedSparse.geometry.dispose();

  const scenePlyPath = path.join(TRAINING_OUT, 'scene.ply');
  const scenePlyBuf = toArrayBuffer(fs.readFileSync(scenePlyPath));
  const parsedScenePly = parsePlyBuffer(scenePlyBuf, { transformMatrix });
  assert.ok(parsedScenePly.count > 0);
  assert.equal(parsedScenePly.skippedInvalidCount, 0);
  parsedScenePly.geometry.dispose();
});

test('Stage 2 Sign-off: COLMAP -> Three.js camera poses project real sparse_points.ply and scene.splat identically', () => {
  const { raw, viewerTransform } = loadRunManifest();
  const transformMatrix = viewerTransformToMatrix4(viewerTransform);

  // Parse sparse points in BOTH COLMAP space and Three.js space
  const sparseBuf = toArrayBuffer(fs.readFileSync(path.join(TRAINING_OUT, 'sparse_points.ply')));
  const sparseColmap = parsePlyBuffer(sparseBuf);
  const sparseThree = parsePlyBuffer(sparseBuf, { transformMatrix });

  const splatBuf = toArrayBuffer(fs.readFileSync(path.join(TRAINING_OUT, 'scene.splat')));
  const splatThree = parseSplatBuffer(splatBuf, { transformMatrix });
  const splatHandle = createSplatMesh(splatThree, { viewportWidth: 960, viewportHeight: 540 });

  const registeredFrames = raw.frames.filter((f) => f.status === 'registered');
  assert.ok(registeredFrames.length > 10);

  const sampleIndices = [0, 10, 50, Math.min(120, registeredFrames.length - 1)];
  let totalChecked = 0;

  for (const idx of sampleIndices) {
    const frame = registeredFrames[idx];
    const camInfo = raw.cameras[String(frame.camera_id)];
    const [qw, qx, qy, qz] = frame.qvec_wxyz;
    const qW2C = new THREE.Quaternion(qx, qy, qz, qw).normalize();
    const tvec = new THREE.Vector3(...frame.tvec_xyz);

    const threePose = colmapExtrinsicsToThreePose(
      frame.qvec_wxyz,
      frame.tvec_xyz,
      { height: camInfo.height, fy: camInfo.fy },
      viewerTransform
    );

    const camera = new THREE.PerspectiveCamera(
      threePose.fov,
      camInfo.width / camInfo.height,
      0.05,
      500
    );
    camera.position.set(...threePose.position);
    camera.up.set(...threePose.up);
    camera.lookAt(new THREE.Vector3(...threePose.target));
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    // Sort real splats against this real training camera
    splatHandle.sortByCamera(camera, true);

    // Check first 40 visible sparse points in this camera
    let checkedForFrame = 0;
    for (let p = 0; p < sparseColmap.count && checkedForFrame < 40; p++) {
      const p3 = p * 3;
      const pColmap = new THREE.Vector3(
        sparseColmap.positions[p3],
        sparseColmap.positions[p3 + 1],
        sparseColmap.positions[p3 + 2]
      );
      const xCam = pColmap.clone().applyQuaternion(qW2C).add(tvec);
      if (xCam.z <= 0.2) continue;

      const uColmap = camInfo.fx * (xCam.x / xCam.z) + camInfo.cx;
      const vColmap = camInfo.fy * (xCam.y / xCam.z) + camInfo.cy;
      if (uColmap < 0 || uColmap >= camInfo.width || vColmap < 0 || vColmap >= camInfo.height) {
        continue;
      }

      const pThree = new THREE.Vector3(
        sparseThree.positions[p3],
        sparseThree.positions[p3 + 1],
        sparseThree.positions[p3 + 2]
      );
      const ndc = pThree.project(camera);
      const uThree = (ndc.x + 1) * 0.5 * camInfo.width;
      const vThree = (1 - ndc.y) * 0.5 * camInfo.height;

      assert.ok(
        Math.abs(uThree - uColmap) < 1e-2,
        `Frame ${frame.frame_id} u mismatch: ${uThree} vs ${uColmap}`
      );
      assert.ok(
        Math.abs(vThree - vColmap) < 1e-2,
        `Frame ${frame.frame_id} v mismatch: ${vThree} vs ${vColmap}`
      );
      checkedForFrame++;
      totalChecked++;
    }
    assert.ok(
      checkedForFrame > 0,
      `Expected visible sparse points in frame ${frame.frame_id}`
    );
  }

  assert.ok(totalChecked >= 40, `Expected >= 40 checked projections, got ${totalChecked}`);

  sparseColmap.geometry.dispose();
  sparseThree.geometry.dispose();
  splatHandle.dispose();
});

test('Stage 2 Sign-off: splatLoader and plyLoader parse real A9 edited scene_edited.splat and scene_edited.ply', () => {
  const rebuildRoot = path.join(REPO_ROOT, 'fixtures', 'room_fixture', 'rebuild_out');
  const manifestRaw = JSON.parse(
    fs.readFileSync(path.join(rebuildRoot, 'run_manifest.json'), 'utf-8')
  );
  const viewerTransform = {
    colmapToThreejsMatrix: manifestRaw.viewer_transform.colmap_to_threejs_matrix,
    sceneBoundsMin: manifestRaw.viewer_transform.scene_bounds_min,
    sceneBoundsMax: manifestRaw.viewer_transform.scene_bounds_max,
  };
  const transformMatrix = viewerTransformToMatrix4(viewerTransform);

  const editedVersion = manifestRaw.scene_versions.find((v) => v.kind === 'edited');
  assert.ok(editedVersion, 'Expected edited scene_version in rebuild_out/run_manifest.json');

  const editedSplatBuf = toArrayBuffer(
    fs.readFileSync(path.join(rebuildRoot, editedVersion.splat_relative_path))
  );
  const parsedEditedSplat = parseSplatBuffer(editedSplatBuf, { transformMatrix });
  assert.ok(parsedEditedSplat.count > 0);
  assert.equal(parsedEditedSplat.skippedInvalidCount, 0);
  assert.ok(!parsedEditedSplat.boundingBox.isEmpty());

  const editedPlyBuf = toArrayBuffer(
    fs.readFileSync(path.join(rebuildRoot, editedVersion.ply_relative_path))
  );
  const parsedEditedPly = parsePlyBuffer(editedPlyBuf, { transformMatrix });
  assert.ok(parsedEditedPly.count > 0);
  assert.equal(parsedEditedPly.skippedInvalidCount, 0);
  parsedEditedPly.geometry.dispose();
});
