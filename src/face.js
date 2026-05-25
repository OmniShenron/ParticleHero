import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';

const CAM_Z   = 3.5;
const CAM_FOV = 50;

// ─────────────────────────────────────────────────────────────────────────────
// VERTEX SHADER
// Zone map:  TOP=Neural  LEFT=Chromatic  RIGHT=Lensing  BOTTOM=Ferro
// ─────────────────────────────────────────────────────────────────────────────
const VERT = /* glsl */`
  attribute vec3  aCol;
  uniform   float uTime;
  uniform   vec3  uMouse;
  uniform   float uOpacity;
  uniform   float uHover;

  uniform float uWneural;
  uniform float uWchromatic;
  uniform float uWlensing;
  uniform float uWferro;

  varying vec3  vCol;
  varying float vMGlow;
  varying float vPulse;

  // Neural
  varying float vNeuralWave;
  varying float vNeuralFlare;

  // Chromatic
  varying float vChromR;
  varying float vChromG;
  varying float vChromB;
  varying float vChromGlow;

  // Lensing
  varying float vGravDist;
  varying float vGravShadow;
  varying float vEinsteinRing;
  varying float vAccretion;

  // Ferro
  varying float vSpikeH;
  varying float vSpikeMask;

  float hash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    vec3  wPos  = (modelMatrix * vec4(position, 1.0)).xyz;
    vec2  d2    = uMouse.xy - wPos.xy;
    float mDist = length(d2);
    vec2  mDir  = mDist > 0.001 ? d2 / mDist : vec2(0.0);
    float H     = uHover;

    vMGlow    = exp(-mDist * 1.7);
    vGravDist = mDist;

    float shimmer = sin(uTime * 1.4 + wPos.x * 4.2 + wPos.y * 3.1) * 0.5 + 0.5;
    vPulse = 0.82 + 0.18 * shimmer;

    // ── Base colour ───────────────────────────────────────────────────────
    float lum = dot(aCol, vec3(0.299, 0.587, 0.114));
    vCol = mix(vec3(0.04, 0.60, 1.0), vec3(0.30, 0.90, 1.0), clamp(lum * 1.4, 0.0, 1.0));

    // ══════════════════════════════════════════════════════════════════════
    // 1. NEURAL CASCADE  (top)
    //    Expanding ripple waves + individual point flare at wave front
    // ══════════════════════════════════════════════════════════════════════
    float nW      = uWneural * H;
    float nPhase  = mDist * 16.0 - uTime * 5.0;
    float nWave   = sin(nPhase) * 0.5 + 0.5;
    float nEnv    = exp(-mDist * 2.8);
    vNeuralWave   = nWave * nEnv * nW;
    // Flare: brief bright flash exactly at wave crest
    float nCrest  = smoothstep(0.75, 1.0, nWave) * nEnv;
    vNeuralFlare  = nCrest * nW;

    // ══════════════════════════════════════════════════════════════════════
    // 2. CHROMATIC DISPERSION  (left)
    //    Split points into R / G / B groups — each shifted on X axis
    //    Strong enough to be clearly visible as colour fringing
    // ══════════════════════════════════════════════════════════════════════
    float cW      = uWchromatic * H;
    float cGlow   = exp(-mDist * 1.8) * cW;
    float cSplit  = cGlow * 0.12;   // 0.12 world units max — visually clear

    // Assign each point a stable channel (R / G / B) from position hash
    float ch = floor(mod(hash(position.x * 91.3 + position.z * 47.2) * 3.0, 3.0));
    float xOff = (ch < 0.5) ? -cSplit :
                 (ch < 1.5) ?  0.0    :
                                cSplit;
    float zOff = (ch - 1.0) * cGlow * 0.018;   // depth separation

    // Per-channel colour intensity for fragment
    vChromR  = (ch < 0.5)  ? cGlow : cGlow * 0.08;
    vChromG  = (ch < 1.5 && ch >= 0.5) ? cGlow : cGlow * 0.06;
    vChromB  = (ch >= 1.5) ? cGlow : cGlow * 0.08;
    vChromGlow = cGlow;

    // ══════════════════════════════════════════════════════════════════════
    // 3. GRAVITATIONAL LENSING  (right)
    //    Compact black hole — Rs=0.10, ring tight at 1.5×Rs, NOT 0.30
    // ══════════════════════════════════════════════════════════════════════
    float gW    = uWlensing * H;
    float Rs    = 0.10;
    float Rring = Rs * 1.55;    // photon ring at 0.155 — compact, not giant

    float gPull = (Rs * Rs * 2.0) / (mDist * mDist + Rs * Rs * 0.5);
    gPull = clamp(gPull, 0.0, 0.85) * gW;

    vec2 tangent   = vec2(-mDir.y, mDir.x);
    float spiral   = clamp(Rs * 1.6 / (mDist + 0.001), 0.0, 0.5);
    vec2 gOff      = mDir * gPull * 0.16 + tangent * gPull * spiral * 0.24;

    float inside   = smoothstep(Rs, 0.0, mDist) * gW;
    gOff          *= (1.0 - inside * 0.88);

    float Rshadow  = Rs * 2.4;
    vGravShadow    = smoothstep(Rshadow, Rshadow * 0.35, mDist) * gW;

    float rW       = 0.009;
    vEinsteinRing  = exp(-pow((mDist - Rring) / rW, 2.0))
                   * (0.55 + 0.45 * sin(uTime * 5.2))
                   * gW;
    vAccretion     = inside * 0.9 + smoothstep(Rring, Rs * 1.1, mDist)
                   * smoothstep(Rs * 2.2, Rring, mDist) * gW * 0.5;

    // ══════════════════════════════════════════════════════════════════════
    // 4. FERROFLUID SPIKES  (bottom)
    //    8 sharp magnetic spikes erupting toward camera (Z+)
    //    Clearly visible — max Z displacement 0.5+ units
    // ══════════════════════════════════════════════════════════════════════
    float fW       = uWferro * H;
    float angle    = atan(d2.y, d2.x);
    // 8 spikes — high exponent = very sharp ridges
    float spikes   = pow(max(0.0, sin(angle * 4.0)), 5.0);  // 8-spike (4 pairs)

    // Radial envelope: peak at 0.28 from cursor, fade inside and outside
    float sR       = 0.28;
    float sEnv     = exp(-pow((mDist - sR * 0.6) / (sR * 0.5), 2.0));
    float sPulse   = 0.75 + 0.25 * sin(uTime * 2.6 + mDist * 8.0);

    float sH       = spikes * sEnv * sPulse * fW * 0.55;   // Z eruption amount
    vSpikeH        = sH;
    vSpikeMask     = spikes * sEnv * fW;

    // ══════════════════════════════════════════════════════════════════════
    // APPLY ALL DISPLACEMENTS
    // ══════════════════════════════════════════════════════════════════════
    vec3 displaced = vec3(
      wPos.x + xOff  + gOff.x,
      wPos.y         + gOff.y,
      wPos.z + zOff  + sH          // chromatic Z-depth + ferro spike
    );

    // Gravity singularity: collapse points at center
    displaced = mix(displaced, vec3(uMouse.xy, wPos.z), inside * gW * 0.9);

    vec4 mvPos = viewMatrix * vec4(displaced, 1.0);
    gl_Position = projectionMatrix * mvPos;

    // ── Point size ────────────────────────────────────────────────────────
    float camDist = max(0.1, -mvPos.z);
    float sz = (2.6 + vMGlow * 2.0) * (${CAM_Z.toFixed(1)} / camDist);

    sz += vNeuralFlare  * 5.0;    // synapse crest flare
    sz += vEinsteinRing * 4.0;    // photon ring
    sz += vSpikeMask    * 3.5;    // spike tip glow
    sz  = mix(sz, sz * 0.4, vGravShadow); // shrink inside void

    gl_PointSize = clamp(sz, 1.0, 20.0);
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// FRAGMENT SHADER
// ─────────────────────────────────────────────────────────────────────────────
const FRAG = /* glsl */`
  uniform float uTime;
  uniform float uOpacity;
  uniform float uHover;
  uniform float uWneural;
  uniform float uWchromatic;
  uniform float uWlensing;
  uniform float uWferro;

  varying vec3  vCol;
  varying float vMGlow;
  varying float vPulse;
  varying float vNeuralWave;
  varying float vNeuralFlare;
  varying float vChromR;
  varying float vChromG;
  varying float vChromB;
  varying float vChromGlow;
  varying float vGravDist;
  varying float vGravShadow;
  varying float vEinsteinRing;
  varying float vAccretion;
  varying float vSpikeH;
  varying float vSpikeMask;

  void main() {
    vec2  uv  = gl_PointCoord - 0.5;
    float d   = length(uv);
    if (d > 0.5) discard;

    float soft = 1.0 - smoothstep(0.18, 0.50, d);
    float core = 1.0 - smoothstep(0.00, 0.14, d);

    vec3 col = vCol;
    float H  = uHover;

    // ── Base hover glow (user values, unchanged) ──────────────────────────
    col = mix(col, vec3(0.45, 0.97, 1.0), vMGlow * 0.34);
    col = mix(col, vec3(1.00, 1.00, 1.0), vMGlow * core * 0.17);

    // ════════════════════════════════════════════════════════════════════
    // 1. NEURAL CASCADE
    //    Crest: brilliant white with cyan halo
    //    Trough: dim afterglow, face visible beneath
    // ════════════════════════════════════════════════════════════════════
    // Wave trough: subtle cyan shimmer traveling ahead of crest
    float nW     = uWneural * H;
    float nTrough = (1.0 - vNeuralFlare) * vNeuralWave;
    col = mix(col, vec3(0.20, 0.88, 1.00), nTrough * soft  * 0.55);
    // Crest: white blast
    col = mix(col, vec3(1.00, 1.00, 1.00), vNeuralFlare * soft  * 0.90);
    col = mix(col, vec3(0.70, 0.98, 1.00), vNeuralFlare * core  * 0.75);

    // ════════════════════════════════════════════════════════════════════
    // 2. CHROMATIC DISPERSION
    //    Each channel (R/G/B) is a separate point group — colour them
    //    so the split is clearly visible as red/green/blue fringes
    // ════════════════════════════════════════════════════════════════════
    float cW = uWchromatic * H;
    // Strong pure-channel tinting so the effect reads clearly
    col = mix(col, vec3(1.00, 0.18, 0.10), vChromR * soft * 0.88);  // Red fringe
    col = mix(col, vec3(0.20, 1.00, 0.35), vChromG * soft * 0.75);  // Green center
    col = mix(col, vec3(0.15, 0.50, 1.00), vChromB * soft * 0.88);  // Blue fringe
    // White bloom at center where all channels converge
    float cCenter = exp(-vGravDist * vGravDist * 18.0) * vChromGlow;
    col = mix(col, vec3(1.00, 1.00, 1.00), cCenter * core * 0.62);

    // ════════════════════════════════════════════════════════════════════
    // 3. GRAVITATIONAL LENSING
    // ════════════════════════════════════════════════════════════════════
    float gW = uWlensing * H;

    // Event horizon — true dark void
    col = mix(col, vec3(0.0, 0.006, 0.018), vGravShadow * 0.97);
    float shadowMult = 1.0 - vGravShadow * 0.93;

    // Photon ring — sharp blue-white arc
    float rFlicker = 0.60 + 0.40 * sin(uTime * 5.2);
    col = mix(col, vec3(0.62, 0.90, 1.00), vEinsteinRing * 0.45 * rFlicker);
    col = mix(col, vec3(1.00, 1.00, 1.00), vEinsteinRing * core * 0.30);

    // Accretion: warm orange-amber inside horizon
    col = mix(col, vec3(1.00, 0.55, 0.15), vAccretion * 0.35);
    col = mix(col, vec3(1.00, 0.90, 0.70), vAccretion * core * 0.25);

    // ════════════════════════════════════════════════════════════════════
    // 4. FERROFLUID SPIKES
    //    Deep black-blue metallic body + bright cyan-white tips
    // ════════════════════════════════════════════════════════════════════
    float fW    = uWferro * H;
    float tipN  = clamp(vSpikeH * 3.0, 0.0, 1.0);
    float bodyN = vSpikeMask * (1.0 - tipN);

    // Dark magnetic fluid body
    col = mix(col, vec3(0.01, 0.06, 0.16), bodyN * soft  * 0.72);
    // Luminous tip (field concentration, like real ferrofluid spikes)
    col = mix(col, vec3(0.25, 0.88, 1.00), tipN  * soft  * 0.85);
    col = mix(col, vec3(1.00, 1.00, 1.00), tipN  * core  * 0.70);

    // ── Shimmer ───────────────────────────────────────────────────────────
    col *= vPulse;

    // ── ALPHA ─────────────────────────────────────────────────────────────
    float baseAlpha   = (soft * 0.55 + core * 0.90) * 0.13;
    float hoverAlpha  = (soft * 0.70 + core * 1.10) * 0.17 * vMGlow;

    float nAlpha  = (vNeuralFlare * 0.22 + vNeuralWave * 0.06) * soft;
    float cAlpha  = (vChromR + vChromG + vChromB) * soft * 0.10;
    float gAlpha  = vEinsteinRing * soft * 0.14 + vAccretion * core * 0.10;
    float fAlpha  = tipN * soft * 0.20 + bodyN * soft * 0.07;

    float alpha = (baseAlpha + hoverAlpha + nAlpha + cAlpha + gAlpha + fAlpha)
                * shadowMult * uOpacity;

    gl_FragColor = vec4(col, max(alpha, 0.0));
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// GEOMETRY + MATERIAL
// ─────────────────────────────────────────────────────────────────────────────
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
  const scale = Math.min((viewH * 0.88) / sz.y, (viewW * 0.85) / sz.x);
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
    vertexShader:   VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime:       { value: 0 },
      uMouse:      { value: new THREE.Vector3(0, 0, 0.5) },
      uOpacity:    { value: 1 },
      uHover:      { value: 0 },
      uWneural:    { value: 0.0 },
      uWchromatic: { value: 0.0 },
      uWlensing:   { value: 0.0 },
      uWferro:     { value: 0.0 },
    },
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    transparent: true,
  });

  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  return { mesh: pts, mat };
}
