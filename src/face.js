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
  uniform   float uHover;       // 0.0 → 1.0, smoothly lerped on/off face

  varying vec3  vCol;
  varying float vMGlow;
  varying float vPulse;
  varying float vGravDist;      // raw distance to cursor — used for Einstein ring
  varying float vGravPull;      // how strongly this point is being warped

  void main() {
    // ── World position (includes mesh tilt rotation) ──────────────────────
    vec3 wPos = (modelMatrix * vec4(position, 1.0)).xyz;

    // ── Glow (for point size + fragment color) ────────────────────────────
    float mDist = length(wPos.xy - uMouse.xy);
    float mGlow = exp(-mDist * 1.7);    // user value
    vMGlow     = mGlow;
    vGravDist  = mDist;

    // ── Shimmer pulse ─────────────────────────────────────────────────────
    float shimmer = sin(uTime * 1.4 + wPos.x * 4.2 + wPos.y * 3.1) * 0.5 + 0.5;
    vPulse = 0.82 + 0.18 * shimmer;

    // ──────────────────────────────────────────────────────────────────────
    // GRAVITATIONAL LENSING
    // Cursor = black hole. Points warp toward it in world XY space.
    // Inside event horizon Rs they get a spiralling slingshot rotation.
    // ──────────────────────────────────────────────────────────────────────
    float Rs = 0.30;                              // Schwarzschild / event-horizon radius
    vec2  delta = uMouse.xy - wPos.xy;
    float gDist = max(length(delta), 0.001);

    // Pull magnitude — peaks sharply just outside Rs, fades with distance
    float pull = (Rs * Rs * 2.2) / (gDist * gDist + Rs * Rs * 0.35);
    pull = clamp(pull, 0.0, 2.6) * uHover;
    vGravPull = pull;

    // Base warp direction: toward cursor
    vec2 gravOffset = (delta / gDist) * pull * 0.36;

    // Inside event horizon: add a spiralling slingshot rotation
    float inside = smoothstep(Rs, 0.0, gDist) * uHover;
    float spiralAngle = inside * 2.4;             // radians of rotation at dead center
    float cosA = cos(spiralAngle);
    float sinA = sin(spiralAngle);
    vec2 spiraled = vec2(
      gravOffset.x * cosA - gravOffset.y * sinA,
      gravOffset.x * sinA + gravOffset.y * cosA
    );
    gravOffset = mix(gravOffset, spiraled, inside);

    // Apply warp to world position, then project
    vec3 warpedWorld = vec3(wPos.xy + gravOffset, wPos.z);
    vec4 mvPos = viewMatrix * vec4(warpedWorld, 1.0);
    gl_Position = projectionMatrix * mvPos;

    // ── Point size: user values + hover expansion ─────────────────────────
    float camDist = max(0.1, -mvPos.z);
    float sz = (2.6 + mGlow * 2.0) * (${CAM_Z.toFixed(1)} / camDist);  // user value
    // Extra size boost inside event horizon (accretion disc glow)
    sz += inside * 4.0 * uHover;
    gl_PointSize = clamp(sz, 1.0, 20.0);

    // ── Holographic cyan base color ───────────────────────────────────────
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
  varying float vGravPull;

  void main() {
    vec2  uv = gl_PointCoord - 0.5;
    float d  = length(uv);
    if (d > 0.5) discard;

    float soft = 1.0 - smoothstep(0.18, 0.50, d);
    float core = 1.0 - smoothstep(0.00, 0.14, d);

    vec3 col = vCol;

    // ── User hover glow values ────────────────────────────────────────────
    col = mix(col, vec3(0.45, 0.97, 1.0), vMGlow * 0.34);           // user value
    col = mix(col, vec3(1.0,  1.0,  1.0), vMGlow * core * 0.17);    // user value

    // ── Gravitational Lensing — Einstein Ring ─────────────────────────────
    // Bright photon ring exactly at Schwarzschild radius Rs = 0.30
    float Rs = 0.30;
    float ringDist = abs(vGravDist - Rs);
    float eRing = exp(-ringDist * ringDist * 62.0)           // tight ring
                * uHover
                * (0.72 + 0.28 * sin(uTime * 2.8));         // slow pulse on ring

    // Ring color: hot white-blue like real gravitational lensing imagery
    col = mix(col, vec3(0.88, 0.97, 1.00), eRing * 0.80);
    col = mix(col, vec3(1.00, 1.00, 1.00), eRing * core * 0.65);

    // Accretion disc: warm orange-white streak for points inside horizon
    float insideFade = smoothstep(Rs, 0.0, vGravDist) * uHover;
    col = mix(col, vec3(1.0, 0.82, 0.55), insideFade * 0.55);  // orange inner glow
    col = mix(col, vec3(1.0, 1.0,  1.0),  insideFade * core * 0.5);

    // ── Shimmer pulse ─────────────────────────────────────────────────────
    col *= vPulse;

    // ── Alpha ─────────────────────────────────────────────────────────────
    float baseAlpha  = (soft * 0.55 + core * 0.90) * 0.13;
    float hoverAlpha = (soft * 0.70 + core * 1.10) * 0.17 * vMGlow;  // user value
    float ringAlpha  = eRing * soft * 0.40;                            // Einstein ring brightness
    float coreAlpha  = insideFade * core * 0.30;                       // accretion disc

    float alpha = (baseAlpha + hoverAlpha + ringAlpha + coreAlpha) * uOpacity;
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

  const viewH = 2 * CAM_Z * Math.tan((CAM_FOV / 2) * (Math.PI / 180));
  const viewW = viewH * (window.innerWidth / window.innerHeight);

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
      uHover:   { value: 0 },   // driven by main.js — 0=idle, 1=on face
    },
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    transparent: true,
  });

  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  return { mesh: pts, mat };
}
