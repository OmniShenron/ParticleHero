import * as THREE from 'three';

const ndc    = new THREE.Vector2();
const target = new THREE.Vector2();
const world  = new THREE.Vector3();
const rc     = new THREE.Raycaster();
const plane  = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

let dot, ring, rx = window.innerWidth/2, ry = window.innerHeight/2;

export function initMouse() {
  dot  = Object.assign(document.createElement('div'), { id: 'cur-dot'  });
  ring = Object.assign(document.createElement('div'), { id: 'cur-ring' });
  document.body.append(dot, ring);

  let ringX = rx, ringY = ry;

  window.addEventListener('mousemove', e => {
    rx = e.clientX; ry = e.clientY;
    dot.style.cssText = `left:${rx}px;top:${ry}px`;
    // Ring follows with lag via RAF
    function followRing() {
      ringX += (rx - ringX) * 0.12;
      ringY += (ry - ringY) * 0.12;
      ring.style.cssText = `left:${ringX}px;top:${ringY}px`;
    }
    requestAnimationFrame(followRing);

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
