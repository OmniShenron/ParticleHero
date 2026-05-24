import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';

const CAM_Z   = 3.5;
const CAM_FOV = 50;

// ── Vertex shader ─────────────────────────────────────────────────────────────
const VERT = /* glsl */`
  attribute vec3  aCol;
  uniform   float uTime;
  uniform   vec3  uMouse;
  uniform   float uOpacity;
  uniform   float uHover;

  varying vec3  vCol;
  varying float vMGlow;
  varying float vPulse;
  varying float vGravDist;
  varying float vInsideFade;

  void main() {
    vec3 wPos = (modelMatrix * vec4(position, 1.0)).xyz;

    // ── Glow radius (user value) ───────────────────────────────────────────
    float mDist = length(wPos.xy - uMouse.xy);
    float mGlow = exp(-mDist * 1.7);
    vMGlow    = mGlow;
    vGravDist = mDist;

    // ── Shimmer pulse ─────────────────────────────────────────────────────
    float shimmer = sin(uTime * 1.4 + wPos.x * 4.2 + wPos.y * 3.1) * 0.5 + 0.5;
    vPulse = 0.82 + 0.18 * shimmer;

    // ──────────────────────────────────────────────────────────────────────
    // CINEMATIC BLACK HOLE — Interstellar / Gargantua style
    //
    // Scale reference: face ≈ 2.8 units tall (solar system)
    //                  Rs  = 0.11 units      (sun)
    //                  Ratio ≈ 1 : 25 — small, contained, cinematic
    // ──────────────────────────────────────────────────────────────────────
    float Rs    = 0.11;
    vec2  delta = uMouse.xy - wPos.xy;
    float gDist = max(length(delta), 0.001);

    // Gravity: only pulls meaningfully within ~3× Rs, negligible beyond
    float pull = (Rs * Rs * 1.4) / (gDist * gDist + Rs * Rs * 0.6);
    pull = clamp(pull, 0.0, 0.72) * uHover;   // hard cap — no flying points

    vec2 gravOffset = (delta / gDist) * pull * 0.16;  // gentle warp

    // Inside event horizon: tight spiral (not explosive)
    float inside = smoothstep(Rs, 0.0, gDist) * uHover;
    vInsideFade  = inside;
    float spiralAngle = inside * 1.1;
    float cosA = cos(spiralAngle), sinA = sin(spiralAngle);
    vec2 spiraled = vec2(
      gravOffset.x * cosA - gravOffset.y * sinA,
      gravOffset.x * sinA + gravOffset.y * cosA
    );
    gravOffset = mix(gravOffset, spiraled, inside);

    // Points at singularity core collapse inward (creates visible dark void)
    float core_collapse = smoothstep(Rs * 0.55, 0.0, gDist) * uHover;
    gravOffset *= (1.0 - core_collapse * 0.85);   // pulls toward center, stops there

    vec3 warpedWorld = vec3(wPos.xy + gravOffset, wPos.z);
    vec4 mvPos = viewMatrix * vec4(warpedWorld, 1.0);
    gl_Position = projectionMatrix * mvPos;

    // ── Point size (user values) ───────────────────────────────────────────
    float camDist = max(0.1, -mvPos.z);
    float sz = (2.6 + mGlow * 2.0) * (${CAM_Z.toFixed(1)} / camDist);
    gl_PointSize = clamp(sz, 1.0, 14.0);

    // ── Base holographic colour ────────────────────────────────────────────
    float lum = dot(aCol, vec3(0.299, 0.587, 0.114));
    vCol = mix(vec3(0.04, 0.60, 1.0), vec3(0.30, 0.90, 1.0), clamp(lum * 1.4, 0.0, 1.0));
  }
`;

// ── Fragment shader ───────────────────────────────────────────────────────────
const FRAG = /* glsl */`
  uniform float uTime;
  uniform float uOpacity;
  uniform float uHover;

  varying vec3  vCol;
  varying float vMGlow;
  varying float vPulse;
  varying float vGravDist;
  varying float vInsideFade;

  void main() {
    vec2  uv = gl_PointCoord - 0.5;
    float d  = length(uv);
    if (d > 0.5) discard;

    float soft = 1.0 - smoothstep(0.18, 0.50, d);
    float core = 1.0 - smoothstep(0.00, 0.14, d);

    vec3 col = vCol;

    // ── User hover glow values (unchanged) ────────────────────────────────
    col = mix(col, vec3(0.45, 0.97, 1.0), vMGlow * 0.34);
    col = mix(col, vec3(1.0,  1.0,  1.0), vMGlow * core * 0.17);

    // ──────────────────────────────────────────────────────────────────────
    // CINEMATIC BLACK HOLE LIGHTING
    //
    //  Zone 1 — Singularity (d < Rs*0.55) : near-BLACK void
    //  Zone 2 — Photon sphere (d ≈ Rs)    : thin dim Einstein ring
    //  Zone 3 — Accretion disc (Rs–3×Rs)  : warm amber, Doppler-shifted
    //  Zone 4 — Outer lensing (> 3×Rs)    : untouched face
    // ──────────────────────────────────────────────────────────────────────
    float Rs = 0.11;

    // Zone 1 — DARK VOID: points near singularity go almost black
    float voidFade = smoothstep(Rs * 0.55, 0.0, vGravDist) * uHover;
    col  = mix(col,  vec3(0.0, 0.02, 0.05), voidFade * 0.92);  // near-black
    // alpha suppressed in void (handled below)

    // Zone 2 — PHOTON SPHERE / EINSTEIN RING
    // Thin, precise, dim — NOT blinding
    float ringDist   = abs(vGravDist - Rs);
    float eRing      = exp(-ringDist * ringDist * 280.0)          // very tight band
                     * uHover
                     * (0.60 + 0.40 * sin(uTime * 2.2));         // slow flicker
    col = mix(col, vec3(0.75, 0.93, 1.00), eRing * 0.22);       // dim blue-white
    col = mix(col, vec3(1.00, 1.00, 1.00), eRing * core * 0.12);

    // Zone 3 — ACCRETION DISC
    // Relativistic Doppler: one side warmer (approaching) vs cooler (receding)
    // Approximated with angular position around cursor
    float doppler   = 0.55 + 0.45 * sin(atan(uv.y, uv.x) + uTime * 0.4);
    vec3  discWarm  = mix(vec3(0.90, 0.52, 0.18), vec3(1.0, 0.78, 0.42), doppler); // amber→gold
    float discFade  = smoothstep(Rs * 3.2, Rs * 0.9, vGravDist)
                    * (1.0 - voidFade)
                    * uHover;
    col = mix(col, discWarm, discFade * 0.18);   // very subtle warmth, not blown out

    // ── Shimmer ───────────────────────────────────────────────────────────
    col *= vPulse;

    // ── Alpha ─────────────────────────────────────────────────────────────
    float baseAlpha  = (soft * 0.55 + core * 0.90) * 0.13;
    float hoverAlpha = (soft * 0.70 + core * 1.10) * 0.17 * vMGlow;
    float ringAlpha  = eRing * soft * 0.10;      // ring adds just a sliver of light
    float discAlpha  = discFade * core * 0.06;   // disc very faint
    float voidAlpha  = voidFade * -0.10;         // void REMOVES alpha (dark hole)

    float alpha = (baseAlpha + hoverAlpha + ringAlpha + discAlpha + voidAlpha)
                * uOpacity;
    alpha = max(alpha, 0.0);

    gl_FragColor = vec4(col, alpha);
  }
`;

export async function loadFace(scene) {
  const loader = new PLYLoader();

  let geo;
  try {
    geo = await loader.loadAsync('/shan3D_points.ply');
    console.log('[Face] PLY loaded — vertices:', geo.attributes.position.count);
  } catch (e) {
    console.error('[Face] PLY FAILED:', e);
    geo = new THREE.SphereGeometry(1.0, 64, 64);
  }

  geo.computeBoundingBox();
  const cen = new THREE.Vector3();
  geo.boundingBox.getCenter(cen);
  geo.translate(-cen.x, -cen.y, -cen.z);

  geo.rotateX(-Math.PI / 2);

  geo.computeBoundingBox();
  geo.boundingBox.getCenter(cen);
  geo.translate(-cen.x, -cen.y, -cen.z);

  geo.computeBoundingBox();
  const sz = new THREE.Vector3();
  geo.boundingBox.getSize(sz);

  const viewH  = 2 * CAM_Z * Math.tan((CAM_FOV / 2) * (Math.PI / 180));
  const viewW  = viewH * (window.innerWidth / window.innerHeight);
  const scaleH = (viewH * 0.88) / sz.y;
  const scaleW = (viewW * 0.85) / sz.x;
  const scale  = Math.min(scaleH, scaleW);
  geo.scale(scale, scale, scale);

  const N       = geo.attributes.position.count;
  const aColBuf = new Float32Array(N * 3);
  if (geo.hasAttribute('color')) {
    const src = geo.attributes.color.array;
    for (let i = 0; i < N * 3; i++) aColBuf[i] = src[i];
    geo.deleteAttribute('color');
  } else {
    for (let i = 0; i < N; i++) {
      aColBuf[i*3]=0.2; aColBuf[i*3+1]=0.75; aColBuf[i*3+2]=1.0;
    }
  }
  geo.setAttribute('aCol', new THREE.BufferAttribute(aColBuf, 3));

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uTime:    { value: 0 },
      uMouse:   { value: new THREE.Vector3(0, 0, 0.5) },
      uOpacity: { value: 1 },
      uHover:   { value: 0 },
    },
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    transparent: true,
  });

  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  return { mesh: pts, mat };
}
