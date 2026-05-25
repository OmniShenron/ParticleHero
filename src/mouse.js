import * as THREE from 'three';

const ndc    = new THREE.Vector2();
const target = new THREE.Vector2();
const world  = new THREE.Vector3();
const rc     = new THREE.Raycaster();
const plane  = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

let dot, rx = window.innerWidth / 2, ry = window.innerHeight / 2;

export function initMouse() {
  // Single clean dot — no lagging ring to avoid "two cursors" confusion
  dot = Object.assign(document.createElement('div'), { id: 'cur-dot' });
  document.body.appendChild(dot);
  dot.style.cssText = `left:${rx}px;top:${ry}px`;

  window.addEventListener('mousemove', e => {
    rx = e.clientX; ry = e.clientY;
    dot.style.left = rx + 'px';
    dot.style.top  = ry + 'px';
    target.x =  (e.clientX / window.innerWidth)  * 2 - 1;
    target.y = -(e.clientY / window.innerHeight) * 2 + 1;
  });

  window.addEventListener('touchmove', e => {
    if (!e.touches.length) return;
    target.x =  (e.touches[0].clientX / window.innerWidth)  * 2 - 1;
    target.y = -(e.touches[0].clientY / window.innerHeight) * 2 + 1;
  }, { passive: true });
}

export function getMouseWorld(camera) {
  ndc.lerp(target, 0.10);
  rc.setFromCamera(ndc, camera);
  rc.ray.intersectPlane(plane, world);
  return world;
}
