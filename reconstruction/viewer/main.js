import * as THREE from '../../frontend/node_modules/three/build/three.module.js';
import {parseSplatBuffer, createSplatMesh, viewerTransformToMatrix4, colmapExtrinsicsToThreePose} from '../../frontend/src/components/studio/loaders/index.ts';

const renderer = new THREE.WebGLRenderer({antialias: false});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
document.body.append(renderer.domElement);
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('aria-label', 'Interactive 3D scene. Use W A S D to move and drag to look.');
const world = new THREE.Scene();
world.background = new THREE.Color('#242424');
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, .01, 10000);
const status = document.querySelector('#status');
const selector = document.querySelector('#scene');
const rotation = new THREE.Euler(0, 0, 0, 'YXZ');
const keys = new Set();
const heldButtons = new Set();
const bindings = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  up: ['KeyE'], down: ['KeyQ'], faster: ['ShiftLeft', 'ShiftRight'],
};
const movementCodes = new Set(Object.values(bindings).flat());
const pressed = action => heldButtons.has(action) || bindings[action].some(code => keys.has(code));
let mesh, manifest, speed = 1, dragging = false, previous = performance.now(), lastSort = 0;
let generation = 0;

function reset() {
  if (!manifest) return;
  const pose = manifest.initial_camera;
  camera.position.set(...pose.position);
  camera.up.set(...pose.up);
  camera.fov = pose.fov;
  camera.lookAt(new THREE.Vector3(...pose.target));
  camera.updateProjectionMatrix();
  rotation.setFromQuaternion(camera.quaternion, 'YXZ');
  camera.updateMatrixWorld(true);
  mesh.sortByCamera(camera, true);
}

async function loadScene(index) {
  const current = ++generation;
  status.textContent = 'Loading Gaussian scene…';
  keys.clear();
  heldButtons.clear();
  try {
    const base = '/scenes/' + index;
    const [json, binary] = await Promise.all([
      fetch(base + '/run_manifest.json'), fetch(base + '/scene.splat'),
    ]);
    if (!json.ok || !binary.ok) throw Error('Could not load scene files');
    const nextManifest = await json.json();
    const bytes = await binary.arrayBuffer();
    if (current !== generation) return;
    const transform = nextManifest.viewer_transform;
    const parsed = parseSplatBuffer(bytes, {transformMatrix: viewerTransformToMatrix4({
      colmapToThreejsMatrix: transform.colmap_to_threejs_matrix,
      sceneBoundsMin: transform.scene_bounds_min, sceneBoundsMax: transform.scene_bounds_max,
    })});
    const nextMesh = createSplatMesh(parsed, {viewportWidth: innerWidth, viewportHeight: innerHeight});
    if (mesh) {
      world.remove(mesh.mesh);
      mesh.dispose();
    }
    manifest = nextManifest;
    mesh = nextMesh;
    world.add(mesh.mesh);
    const positions = manifest.frames.filter(frame => frame.status === 'registered')
      .map(frame => colmapExtrinsicsToThreePose(frame.qvec_wxyz, frame.tvec_xyz).position);
    const pathLength = positions.reduce((sum, point, i) => i ? sum + Math.hypot(...point.map((v,j) => v-positions[i-1][j])) : 0, 0);
    speed = Math.max(.1, pathLength / 30);
    reset();
    status.textContent = parsed.count.toLocaleString() + ' Gaussians · W A S D or arrow keys to move · drag to look';
    document.body.dataset.ready = 'yes';
  } catch (error) {
    status.textContent = error.message;
  }
}

document.querySelector('#reset').onclick = reset;
selector.onchange = () => loadScene(selector.value);
renderer.domElement.onpointerdown = event => {
  renderer.domElement.focus({preventScroll: true});
  dragging = true;
  renderer.domElement.setPointerCapture(event.pointerId);
};
renderer.domElement.onpointermove = event => {
  if (!dragging) return;
  rotation.y -= event.movementX * .003;
  rotation.x = THREE.MathUtils.clamp(rotation.x - event.movementY * .003, -1.5, 1.5);
  camera.quaternion.setFromEuler(rotation);
};
renderer.domElement.onpointerup = () => { dragging = false; };
renderer.domElement.onpointercancel = () => { dragging = false; };
addEventListener('keydown', event => {
  if (['INPUT', 'SELECT', 'BUTTON'].includes(event.target.tagName)) return;
  if (!movementCodes.has(event.code)) return;
  event.preventDefault();
  keys.add(event.code);
});
addEventListener('keyup', event => keys.delete(event.code));
addEventListener('blur', () => {keys.clear(); heldButtons.clear(); dragging = false;});
for (const button of document.querySelectorAll('[data-move]')) {
  button.onpointerdown = event => {
    event.preventDefault();
    renderer.domElement.focus({preventScroll: true});
    button.setPointerCapture(event.pointerId);
    heldButtons.add(button.dataset.move);
  };
  const release = () => heldButtons.delete(button.dataset.move);
  button.onpointerup = release;
  button.onpointercancel = release;
  button.onlostpointercapture = release;
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
const direction = new THREE.Vector3();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - previous) / 1000, .25);
  previous = now;
  direction.set(Number(pressed('right')) - Number(pressed('left')),
                Number(pressed('up')) - Number(pressed('down')),
                Number(pressed('back')) - Number(pressed('forward')));
  if (direction.lengthSq()) {
    direction.normalize().applyQuaternion(camera.quaternion);
    camera.position.addScaledVector(direction, dt * speed * Number(document.querySelector('#speed').value) * (pressed('faster') ? 3 : 1));
  }
  camera.updateMatrixWorld();
  if (mesh && now - lastSort > 100) {
    mesh.sortByCamera(camera);
    lastSort = now;
  }
  renderer.render(world, camera);
}
requestAnimationFrame(animate);
const scenes = await fetch('/scenes.json').then(response => response.json());
for (const scene of scenes) {
  const option = document.createElement('option');
  option.value = scene.id;
  option.textContent = scene.label;
  selector.append(option);
}
await loadScene(0);
