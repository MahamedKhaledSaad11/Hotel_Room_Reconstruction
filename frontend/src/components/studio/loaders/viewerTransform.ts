import * as THREE from 'three';
import type { CameraPose, ViewerTransform } from '../../../types/index.ts';

/**
 * Canonical COLMAP (+X right, +Y down, +Z forward) to Three.js (+X right, +Y up, -Z forward)
 * 4x4 row-major homogeneous transformation matrix: diag(1, -1, -1, 1).
 */
export const DEFAULT_COLMAP_TO_THREEJS_MATRIX: readonly number[][] = [
  [1, 0, 0, 0],
  [0, -1, 0, 0],
  [0, 0, -1, 0],
  [0, 0, 0, 1],
];

/**
 * Converts a ViewerTransform (or default diag(1, -1, -1, 1)) into a THREE.Matrix4.
 */
export function viewerTransformToMatrix4(vt?: ViewerTransform | null): THREE.Matrix4 {
  const m = vt?.colmapToThreejsMatrix;
  if (
    !m ||
    m.length !== 4 ||
    m.some((row) => !Array.isArray(row) || row.length !== 4 || row.some((v) => !Number.isFinite(v)))
  ) {
    return new THREE.Matrix4().set(
      1, 0, 0, 0,
      0, -1, 0, 0,
      0, 0, -1, 0,
      0, 0, 0, 1
    );
  }
  return new THREE.Matrix4().set(
    m[0][0], m[0][1], m[0][2], m[0][3],
    m[1][0], m[1][1], m[1][2], m[1][3],
    m[2][0], m[2][1], m[2][2], m[2][3],
    m[3][0], m[3][1], m[3][2], m[3][3]
  );
}

/**
 * Extracts rotation quaternion and uniform scale from a 4x4 rigid/similarity transform matrix.
 */
export function decomposeRigidTransform(matrix: THREE.Matrix4): {
  quaternion: THREE.Quaternion;
  scale: number;
} {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scaleVec = new THREE.Vector3();
  matrix.decompose(pos, quat, scaleVec);
  const avgScale = (Math.abs(scaleVec.x) + Math.abs(scaleVec.y) + Math.abs(scaleVec.z)) / 3;
  return {
    quaternion: quat.normalize(),
    scale: Number.isFinite(avgScale) && avgScale > 0 ? avgScale : 1,
  };
}

/**
 * Transforms a 3D point from COLMAP world coordinates to Three.js world coordinates.
 */
export function transformColmapPointToThree(
  point: readonly [number, number, number],
  vt?: ViewerTransform | null
): [number, number, number] {
  const mat = viewerTransformToMatrix4(vt);
  const v = new THREE.Vector3(point[0], point[1], point[2]).applyMatrix4(mat);
  return [v.x, v.y, v.z];
}

/**
 * Transforms a CameraPose expressed in COLMAP world space into Three.js world space.
 */
export function transformColmapPoseToThree(
  pose: CameraPose,
  vt?: ViewerTransform | null
): CameraPose {
  return {
    ...pose,
    position: transformColmapPointToThree(pose.position, vt),
    target: transformColmapPointToThree(pose.target, vt),
  };
}

/**
 * Converts COLMAP world-to-camera extrinsics (qvec_wxyz, tvec_xyz) and optional pinhole
 * intrinsics (height, fy) into a Three.js world-space camera pose (position, target, up, fov).
 *
 * Math:
 * - COLMAP world-to-camera: x_cam = R * x_world + t
 * - Camera center in COLMAP world: C = -R^T * t
 * - Camera forward (+Z_cam) in COLMAP world: f = R^T * [0, 0, 1]^T
 * - Camera up (-Y_cam) in COLMAP world: u = R^T * [0, -1, 0]^T
 * - All vectors/points are then mapped by viewerTransformToMatrix4(vt).
 */
export function colmapExtrinsicsToThreePose(
  qvecWxyz: readonly [number, number, number, number],
  tvecXyz: readonly [number, number, number],
  intrinsics?: { height: number; fy: number },
  vt?: ViewerTransform | null
): {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fov?: number;
} {
  const [qw, qx, qy, qz] = qvecWxyz;
  // THREE.Quaternion constructor order is (x, y, z, w)
  const qW2C = new THREE.Quaternion(qx, qy, qz, qw).normalize();
  const qC2W = qW2C.clone().invert();

  const t = new THREE.Vector3(tvecXyz[0], tvecXyz[1], tvecXyz[2]);
  const centerColmap = t.clone().negate().applyQuaternion(qC2W);
  const forwardColmap = new THREE.Vector3(0, 0, 1).applyQuaternion(qC2W).normalize();
  const upColmap = new THREE.Vector3(0, -1, 0).applyQuaternion(qC2W).normalize();
  const targetColmap = centerColmap.clone().add(forwardColmap);

  const mat = viewerTransformToMatrix4(vt);
  const rotOnly = new THREE.Matrix4().extractRotation(mat);

  const centerThree = centerColmap.applyMatrix4(mat);
  const targetThree = targetColmap.applyMatrix4(mat);
  const upThree = upColmap.applyMatrix4(rotOnly).normalize();

  let fov: number | undefined;
  if (intrinsics && intrinsics.height > 0 && intrinsics.fy > 0) {
    fov = (2 * Math.atan(intrinsics.height / (2 * intrinsics.fy)) * 180) / Math.PI;
  }

  return {
    position: [centerThree.x, centerThree.y, centerThree.z],
    target: [targetThree.x, targetThree.y, targetThree.z],
    up: [upThree.x, upThree.y, upThree.z],
    fov,
  };
}

/**
 * Computes sensible orbit/walkthrough bounds and default camera framing from a scene Box3,
 * falling back to ViewerTransform scene_bounds_min/max when provided.
 */
export function computeNavigationBounds(
  box: THREE.Box3 | null,
  vt?: ViewerTransform | null
): {
  boundsBox: THREE.Box3;
  center: THREE.Vector3;
  radius: number;
  defaultCameraPos: THREE.Vector3;
  defaultTarget: THREE.Vector3;
  minRadius: number;
  maxRadius: number;
} {
  let boundsBox: THREE.Box3;
  if (box && !box.isEmpty()) {
    boundsBox = box.clone();
  } else if (vt?.sceneBoundsMin && vt?.sceneBoundsMax) {
    boundsBox = new THREE.Box3(
      new THREE.Vector3(...vt.sceneBoundsMin),
      new THREE.Vector3(...vt.sceneBoundsMax)
    );
  } else {
    boundsBox = new THREE.Box3(
      new THREE.Vector3(-4, -0.5, -4),
      new THREE.Vector3(4, 3.5, 4)
    );
  }

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  boundsBox.getSize(size);
  boundsBox.getCenter(center);

  const radius = Math.max(0.5, size.length() * 0.5);
  const minRadius = Math.max(0.25, radius * 0.12);
  const maxRadius = Math.max(8.0, radius * 4.0);

  // Pad navigation bounds around the scene box so free-fly can back out to inspect the room
  const pad = Math.max(1.5, radius * 0.65);
  const navBox = boundsBox.clone().expandByScalar(pad);

  const defaultTarget = center.clone();
  const defaultCameraPos = center
    .clone()
    .add(new THREE.Vector3(radius * 0.72, radius * 0.35, radius * 0.88));

  return {
    boundsBox: navBox,
    center,
    radius,
    defaultCameraPos,
    defaultTarget,
    minRadius,
    maxRadius,
  };
}
