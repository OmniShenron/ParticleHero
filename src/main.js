import './style.css';
import { createScene }               from './scene.js';
import { loadFace }                  from './face.js';
import { initMouse, getMouseWorld }  from './mouse.js';
import { setupScroll }               from './scroll.js';

// ── Zone map ────────────────────────────────────────────────────────────────
//   TOP    → Neural Cascade      (cursor y > 0, |y| > |x|)
//   LEFT   → Chromatic Dispersion (cursor x < 0, |x| > |y|)
//   RIGHT  → Gravitational Lensing(cursor x > 0, |x| > |y|)
//   BOTTOM → Ferrofluid Spikes    (cursor y < 0, |y| > |x|)
// ─────────────────────────────────────────────────────────────────────────────
const GHOST    = 0.0;   // effects fully off when not in zone
const LERP_ON  = 0.08;
const LERP_OFF = 0.03;

async function main() {
  const { scene, camera, composer, bloom } = createScene();
  const face = await loadFace(scene);

  const loader = document.getElementById('loader');
  if (loader) {
    loader.classList.add('fade-out');
    setTimeout(() => loader.remove(), 1100);
  }

  face.mat.uniforms.uOpacity.value = 1.0;

  initMouse();
  setupScroll({ camera, bloom, face });

  const FACE_RADIUS = 1.55;
  let hoverTarget   = 0;
  window.addEventListener('mouseleave', () => { hoverTarget = 0; });

  let wNeural = 0, wChromatic = 0, wLensing = 0, wFerro = 0;

  let prev = performance.now(), t = 0;
  let targetRotX = 0, targetRotY = 0;

  function tick() {
    requestAnimationFrame(tick);
    const now = performance.now();
    const dt  = Math.min((now - prev) / 1000, 0.05);
    prev = now; t += dt;

    const mouse = getMouseWorld(camera);

    // ── Global hover (use world dist — face center is always near origin) ──
    const dist = Math.sqrt(mouse.x * mouse.x + mouse.y * mouse.y);
    hoverTarget = dist < FACE_RADIUS ? 1 : 0;
    const lerpH = hoverTarget > face.mat.uniforms.uHover.value ? 0.08 : 0.025;
    face.mat.uniforms.uHover.value += (hoverTarget - face.mat.uniforms.uHover.value) * lerpH;
    const H = face.mat.uniforms.uHover.value;

    // ── Zone weights — use raw world mouse for direction (pre-tilt) ───────
    const nx  = mouse.x / 1.55;
    const ny  = mouse.y / 1.00;

    const absX = Math.abs(nx);
    const absY = Math.abs(ny);

    let tN = GHOST, tC = GHOST, tL = GHOST, tF = GHOST;

    if (H > 0.05) {
      // Soft blend on diagonals: within 25° of 45° both adjacent zones share
      const blend = 0.25;

      if (absX >= absY) {
        // Left / Right dominates
        const purity = Math.min((absX - absY) / blend, 1.0);
        if (nx > 0) {
          tL = purity;
          // Share with vertical neighbour on diagonal
          tN = ny > 0 ? (1.0 - purity) * 0.8 : GHOST;
          tF = ny < 0 ? (1.0 - purity) * 0.8 : GHOST;
        } else {
          tC = purity;
          tN = ny > 0 ? (1.0 - purity) * 0.8 : GHOST;
          tF = ny < 0 ? (1.0 - purity) * 0.8 : GHOST;
        }
      } else {
        // Top / Bottom dominates
        const purity = Math.min((absY - absX) / blend, 1.0);
        if (ny > 0) {
          tN = purity;
          tL = nx > 0 ? (1.0 - purity) * 0.8 : GHOST;
          tC = nx < 0 ? (1.0 - purity) * 0.8 : GHOST;
        } else {
          tF = purity;
          tL = nx > 0 ? (1.0 - purity) * 0.8 : GHOST;
          tC = nx < 0 ? (1.0 - purity) * 0.8 : GHOST;
        }
      }
    }

    // Smooth lerp
    const lw = (c, t2) => c + (t2 - c) * (t2 > c ? LERP_ON : LERP_OFF);
    wNeural    = lw(wNeural,    tN);
    wChromatic = lw(wChromatic, tC);
    wLensing   = lw(wLensing,   tL);
    wFerro     = lw(wFerro,     tF);

    face.mat.uniforms.uWneural.value    = wNeural;
    face.mat.uniforms.uWchromatic.value = wChromatic;
    face.mat.uniforms.uWlensing.value   = wLensing;
    face.mat.uniforms.uWferro.value     = wFerro;

    face.mat.uniforms.uTime.value = t;

    // Apply tilt BEFORE computing local mouse so worldToLocal uses current matrix
    targetRotY =  mouse.x * 0.28;
    targetRotX = -mouse.y * 0.18;
    face.mesh.rotation.y += (targetRotY - face.mesh.rotation.y) * 0.055;
    face.mesh.rotation.x += (targetRotX - face.mesh.rotation.x) * 0.055;
    face.mesh.updateMatrixWorld();

    // Convert world mouse → local object space so the shader effect
    // stays fixed relative to the face surface regardless of tilt
    const localMouse = mouse.clone();
    face.mesh.worldToLocal(localMouse);
    face.mat.uniforms.uMouse.value.copy(localMouse);

    composer.render();
  }

  tick();
}

main().catch(console.error);
