// Run with Node 24+ and the dependencies from the existing frontend installed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  colmapExtrinsicsToThreePose,
  createSplatMesh,
  parseSplatBuffer,
  viewerTransformToMatrix4,
} from '../frontend/src/components/studio/loaders/index.ts';

async function checkViewer(directory) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'run_manifest.json'), 'utf8'));
  const transform = manifest.viewer_transform;
  const matrix = transform.colmap_to_threejs_matrix;
  assert.ok(Array.isArray(matrix) && matrix.length === 4 && matrix.every(row =>
    Array.isArray(row) && row.length === 4 && row.every(Number.isFinite)), 'Invalid world transform');
  const viewerTransform = {
    colmapToThreejsMatrix: transform.colmap_to_threejs_matrix,
    sceneBoundsMin: transform.scene_bounds_min,
    sceneBoundsMax: transform.scene_bounds_max,
  };
  const file = await readFile(path.join(directory, 'scene.splat'));
  const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const parsed = parseSplatBuffer(bytes, { transformMatrix: viewerTransformToMatrix4(viewerTransform) });
  assert.equal(parsed.skippedInvalidCount, 0, 'Scene contains invalid Gaussians');
  assert.ok(parsed.count > 0 && !parsed.boundingBox.isEmpty(), 'Empty scene');
  assert.ok(parsed.colors.some((value, index) => index % 4 === 3 && value > 0.01), 'Scene is transparent');
  const registered = manifest.frames.filter((frame) => frame.status === 'registered');
  assert.ok(registered.length >= 2, 'At least two registered views are required');
  for (const frame of registered) {
    const camera = manifest.cameras[String(frame.camera_id)];
    const pose = colmapExtrinsicsToThreePose(frame.qvec_wxyz, frame.tvec_xyz, camera, viewerTransform);
    assert.ok([...pose.position, ...pose.target, ...pose.up, pose.fov].every(Number.isFinite),
      'Invalid viewer camera for frame ' + frame.frame_id);
  }
  const mesh = createSplatMesh(parsed, { viewportWidth: 960, viewportHeight: 540 });
  mesh.dispose();
  console.log(JSON.stringify({ gaussians: parsed.count, registeredViews: registered.length, bytes: bytes.byteLength }));
}

if (!process.argv[2]) {
  console.error('Usage: node reconstruction/check_viewer.mjs RUN_DIRECTORY');
  process.exitCode = 2;
} else {
  await checkViewer(process.argv[2]);
}
