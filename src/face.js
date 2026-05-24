import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';

const CAM_Z   = 3.5;
const CAM_FOV = 50;

// ─────────────────────────────────────────────────────────────────────────────
// VERTEX SHADER
// ─────────────────────────────────────────────────────────────────────────────
const VERT = /* glsl */`
  attribute vec3  aCol;
  uniform   float uTime;
  uniform   vec3  uMouse;
  uniform   float uOpacity;
  uniform   float uHover;

  varying vec3  vCol;
  varying float vPulse;
  varying float vMGlow;
  // ── Black hole varyings ──────────────────────────────────────────────────
  varying float vR2D;         // 2D XY distance from singularity
  varying float vShadow;      // 0→1 inside photon capture radius (dark void)
  varying float vPhotonRing;  // intensity of the photon sphere ring
  varying float vDiskMask;    // 0→1 whether this point is inside the accretion disk
  varying float vDiskTNorm;   // 0=inner-hot, 1=outer-cool (temperature position)
  varying float vDoppler;     // relativistic Doppler-beaming factor
  varying float vJet;         // relativistic jet cone intensity
  varying float vWave;        // gravitational wave displacement (for fragment flicker)

  // ── Physical constants ───────────────────────────────────────────────────
  // Disk tilted ~18° around Y, 6° around X from face-normal (+Z)
  // so it appears as a natural ellipse to the viewer
  const vec3  DISK_NORMAL = normalize(vec3(0.30, 0.10, 0.948));
  const vec3  CAM_DIR     = vec3(0.0, 0.0, 1.0);   // camera looks along +Z at face

  // Scale: face height ≈ 2.5 world units (solar system)
  //        Rs = 0.10                      (sun)  → ratio 1:25, cinematic & contained
  const float Rs       = 0.10;
  const float Rshadow  = 2.60 * Rs;   // = 0.260  observable shadow radius
  const float Rphoton  = 2.72 * Rs;   // = 0.272  photon-sphere ring
  const float Risco    = 3.00 * Rs;   // = 0.300  innermost stable circular orbit
  const float RdiskOut = 5.50 * Rs;   // = 0.550  outer disk edge (contained, not full face)

  void main() {
    vec3 wPos   = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 d3     = uMouse - wPos;           // vector from point → singularity (3D)
    vec2 d2     = uMouse.xy - wPos.xy;     // same in XY plane
    float r2D   = length(d2);
    float r3D   = length(d3);
    vR2D = r2D;

    // ── 1. GRAVITATIONAL INFALL + KEPLERIAN SPIRAL ───────────────────────
    // Pull strength: GR Schwarzschild → peaks sharply near Rs, falls off as 1/r²
    float pull = (Rs * Rs * 2.2) / (r2D * r2D + Rs * Rs * 0.55);
    pull = clamp(pull, 0.0, 0.82) * uHover;

    vec2 pullDir = (r2D > 0.001) ? d2 / r2D : vec2(0.0);
    vec2 tangent = vec2(-pullDir.y, pullDir.x);   // orbital tangent (prograde)

    // Spiral ratio: more tangential drag closer to ISCO (Keplerian speed ∝ 1/√r)
    float spiralRatio = clamp(Rs * 1.8 / (r2D + 0.001), 0.0, 0.55);
    vec2 gravOffset   = pullDir * pull * 0.18
                      + tangent * pull * spiralRatio * 0.28;

    // ── 2. GRAVITATIONAL WAVES ───────────────────────────────────────────
    // Outward-propagating spacetime ripples (like post-merger ringdown)
    float wPhase  = r2D * 26.0 - uTime * 3.2;
    float wAmp    = 0.0055 * exp(-r2D * 4.8) * uHover;
    float wVal    = sin(wPhase) * wAmp;
    wVal         *= smoothstep(Rshadow * 0.85, Rshadow * 1.3, r2D);  // only outside shadow
    vec2 waveDisp = pullDir * wVal;
    vWave         = wVal;

    // Apply all spatial displacements
    vec3 warpedWorld = vec3(wPos.xy + gravOffset + waveDisp, wPos.z);
    vec4 mvPos = viewMatrix * vec4(warpedWorld, 1.0);
    gl_Position = projectionMatrix * mvPos;

    // ── 3. EVENT HORIZON / SHADOW ────────────────────────────────────────
    // Inside photon capture radius the observer sees nothing — true darkness
    vShadow = smoothstep(Rshadow, Rshadow * 0.40, r2D) * uHover;

    // ── 4. PHOTON SPHERE RING ────────────────────────────────────────────
    // Photons orbit at 1.5 Rs; their image appears at ~2.72 Rs (lensed)
    // Width ≈ 0.01 world units — extremely thin, like real EHT imagery
    float rW    = 0.011;
    vPhotonRing = exp(-pow((r2D - Rphoton) / rW, 2.0))
                * (0.65 + 0.35 * sin(uTime * 4.8))  // fast relativistic shimmer
                * uHover;

    // ── 5. ACCRETION DISK (3D tilted plane geometry) ─────────────────────
    // Project each point onto the disk plane through the singularity
    float hDisk     = dot(d3, DISK_NORMAL);          // signed height above disk
    vec3  radVec    = d3 - hDisk * DISK_NORMAL;      // in-plane radial vector
    float rDisk     = length(radVec);

    // Thickness: geometrically thin disk, slightly flared outward (SSD model)
    float hMax      = 0.016 + rDisk * 0.060;
    float thickness = exp(-(hDisk * hDisk) / (hMax * hMax));

    // Radial zone mask: smooth in/out at ISCO and outer edge
    float zone      = smoothstep(Risco - 0.015, Risco + 0.025, rDisk)
                    * smoothstep(RdiskOut + 0.04, RdiskOut - 0.04, rDisk);

    // Turbulent flickering (MHD instabilities in real disks)
    float flicker   = 0.82 + 0.18 * sin(uTime * 9.2 + rDisk * 11.0);

    vDiskMask  = thickness * zone * flicker * uHover;
    vDiskTNorm = clamp((rDisk - Risco) / (RdiskOut - Risco), 0.0, 1.0);

    // ── 6. RELATIVISTIC DOPPLER BEAMING ─────────────────────────────────
    // Prograde orbital velocity direction in disk plane
    vec3 radDir  = (rDisk > 0.001) ? radVec / rDisk : vec3(1.0, 0.0, 0.0);
    vec3 orbDir  = normalize(cross(DISK_NORMAL, radDir));  // tangential, prograde

    // Keplerian + GR: v/c = sqrt(Rs / 2r), max ~0.41c at ISCO
    float beta     = clamp(sqrt(Rs / (2.0 * rDisk + 0.001)), 0.0, 0.41);
    float gamma    = 1.0 / sqrt(max(1.0 - beta * beta, 0.001));
    float cosTheta = dot(orbDir, CAM_DIR);
    // Relativistic beaming: I_obs = I_emit * δ³  where δ = 1/(γ(1−βcosθ))
    float doppler_shift = 1.0 / (gamma * (1.0 - beta * cosTheta));
    vDoppler = (zone > 0.0) ? clamp(pow(doppler_shift, 3.0), 0.04, 5.5) : 1.0;

    // ── 7. RELATIVISTIC JETS ─────────────────────────────────────────────
    // Narrow synchrotron jets along spin axis (DISK_NORMAL), both poles
    float jetCosAngle   = abs(dot(normalize(d3 + vec3(0.001)), DISK_NORMAL));
    float halfCone      = cos(radians(11.0));   // ~11° half-angle (tight jet)
    float jetCone       = smoothstep(halfCone - 0.045, halfCone, jetCosAngle);

    // Plasma knots: bright blobs propagating outward along the jet
    float knotPhase     = r3D * 5.5 - uTime * 2.8;
    float knot          = 0.68 + 0.32 * sin(knotPhase);

    float jetFade       = exp(-r3D * 1.3) * step(Rshadow + 0.01, r2D);
    vJet = jetCone * jetFade * knot * uHover;

    // ── 8. POINT SIZE ────────────────────────────────────────────────────
    float mDist  = length(wPos.xy - uMouse.xy);
    float mGlow  = exp(-mDist * 1.7);      // user value
    vMGlow = mGlow;

    float camDist = max(0.1, -mvPos.z);
    float sz      = (2.6 + mGlow * 2.0) * (${CAM_Z.toFixed(1)} / camDist);  // user value
    sz += vPhotonRing * 2.5;   // ring particles appear brighter/larger
    sz += vJet        * 2.0;   // jet streaks
    gl_PointSize = clamp(sz, 1.0, 16.0);

    // ── 9. SHIMMER ───────────────────────────────────────────────────────
    float shimmer = sin(uTime * 1.4 + wPos.x * 4.2 + wPos.y * 3.1) * 0.5 + 0.5;
    vPulse = 0.82 + 0.18 * shimmer;

    // ── 10. BASE HOLOGRAPHIC COLOR ───────────────────────────────────────
    float lum = dot(aCol, vec3(0.299, 0.587, 0.114));
    vCol = mix(vec3(0.04, 0.60, 1.0), vec3(0.30, 0.90, 1.0), clamp(lum * 1.4, 0.0, 1.0));
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// FRAGMENT SHADER
// ─────────────────────────────────────────────────────────────────────────────
const FRAG = /* glsl */`
  uniform float uTime;
  uniform float uOpacity;
  uniform float uHover;

  varying vec3  vCol;
  varying float vPulse;
  varying float vMGlow;
  varying float vR2D;
  varying float vShadow;
  varying float vPhotonRing;
  varying float vDiskMask;
  varying float vDiskTNorm;
  varying float vDoppler;
  varying float vJet;
  varying float vWave;

  void main() {
    vec2  uv   = gl_PointCoord - 0.5;
    float d    = length(uv);
    if (d > 0.5) discard;

    float soft = 1.0 - smoothstep(0.18, 0.50, d);
    float core = 1.0 - smoothstep(0.00, 0.14, d);

    vec3 col = vCol;

    // ── User hover glow (kept exactly as set) ────────────────────────────
    col = mix(col, vec3(0.45, 0.97, 1.0), vMGlow * 0.34);
    col = mix(col, vec3(1.00, 1.00, 1.0), vMGlow * core * 0.17);

    // ─────────────────────────────────────────────────────────────────────
    // I. EVENT HORIZON — TRUE DARKNESS
    // No light escapes past Rshadow. Points in this zone go near-black.
    // vShadow=1 at center, 0 at Rshadow boundary.
    // ─────────────────────────────────────────────────────────────────────
    col = mix(col, vec3(0.0, 0.008, 0.022), vShadow * 0.97);
    float shadowMult = 1.0 - vShadow * 0.94;   // suppresses alpha in void

    // ─────────────────────────────────────────────────────────────────────
    // II. PHOTON SPHERE RING
    // Thin, precise blue-white ring. NOT blinding — just a clear bright arc.
    // Flickers slightly (orbiting photon timescale).
    // ─────────────────────────────────────────────────────────────────────
    col = mix(col, vec3(0.68, 0.91, 1.00), vPhotonRing * 0.32);
    col = mix(col, vec3(0.95, 1.00, 1.00), vPhotonRing * core * 0.18);

    // ─────────────────────────────────────────────────────────────────────
    // III. ACCRETION DISK — MULTI-TEMPERATURE WITH DOPPLER BEAMING
    //
    // Physical temperature gradient (Stefan-Boltzmann T ∝ r^-3/4):
    //   Inner (t=0): blue-white  ~10^7 K
    //   Mid-inner:   gold        ~10^6 K
    //   Mid-outer:   amber       ~10^5 K
    //   Outer (t=1): deep red    ~10^4 K
    //
    // Doppler beaming: approaching side 3–5× brighter (correct GR formula)
    // ─────────────────────────────────────────────────────────────────────
    float t = vDiskTNorm;

    // 4-stop temperature gradient — smooth, no if/else
    vec3 c_inner = vec3(0.55, 0.82, 1.00);   // blue-white  (inner hot)
    vec3 c_mgold = vec3(1.00, 0.96, 0.78);   // warm white-gold
    vec3 c_amber = vec3(1.00, 0.62, 0.20);   // amber-orange
    vec3 c_outer = vec3(0.68, 0.20, 0.06);   // deep red    (outer cool)

    vec3 diskCol = mix(c_inner, c_mgold, smoothstep(0.00, 0.28, t));
    diskCol      = mix(diskCol, c_amber, smoothstep(0.28, 0.62, t));
    diskCol      = mix(diskCol, c_outer, smoothstep(0.62, 1.00, t));

    // Doppler: approaching side up to ~4.5× brighter, bluer; receding side dim, redder
    float dop    = clamp(vDoppler, 0.04, 4.8);
    diskCol      = diskCol * dop;
    // Colour shift: Doppler blue-shift on bright side, red on dim side
    diskCol.r   *= (dop < 1.0) ? (0.7 + 0.3 * dop) : 1.0;    // redshift on dim side
    diskCol.b   *= (dop > 1.0) ? (0.8 + 0.2 * dop) : 1.0;    // blueshift on bright side
    diskCol      = min(diskCol, vec3(2.2, 1.8, 1.6));           // hard cap — no blowout

    // Blend disk into base color
    col = mix(col, diskCol, vDiskMask * 0.52);

    // ─────────────────────────────────────────────────────────────────────
    // IV. RELATIVISTIC JETS
    // Synchrotron radiation: deep blue → bright cyan
    // Plasma knots already encoded in vJet (from vertex shader)
    // ─────────────────────────────────────────────────────────────────────
    float jetPulse = 0.62 + 0.38 * sin(uTime * 8.5);   // fast plasma instability
    vec3  jetCol   = mix(vec3(0.18, 0.42, 1.00), vec3(0.48, 0.78, 1.00), jetPulse);
    col = mix(col, jetCol,              vJet * 0.60);
    col = mix(col, vec3(0.88, 0.94, 1.00), vJet * core * 0.35);

    // ─────────────────────────────────────────────────────────────────────
    // V. GRAVITATIONAL WAVE SHIMMER
    // Subtle brightness ripple on outer face as waves pass through
    // ─────────────────────────────────────────────────────────────────────
    float waveBright = 1.0 + vWave * 18.0 * soft;  // wave modulates luminance
    col *= waveBright;

    // ── Shimmer pulse ─────────────────────────────────────────────────────
    col *= vPulse;

    // ─────────────────────────────────────────────────────────────────────
    // ALPHA BUDGET
    // Keep each contributor modest — bloom in scene.js handles the glow
    // ─────────────────────────────────────────────────────────────────────
    float baseAlpha  = (soft * 0.55 + core * 0.90) * 0.13;
    float hoverAlpha = (soft * 0.70 + core * 1.10) * 0.17 * vMGlow;   // user value
    float ringAlpha  = vPhotonRing * soft * 0.11;   // thin, precise, not blinding
    float diskAlpha  = vDiskMask   * soft * 0.09 * clamp(vDoppler * 0.5, 0.02, 1.0);
    float jetAlpha   = vJet        * core * 0.12;

    float alpha = (baseAlpha + hoverAlpha + ringAlpha + diskAlpha + jetAlpha)
                * shadowMult
                * uOpacity;

    gl_FragColor = vec4(col, max(alpha, 0.0));
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// GEOMETRY + MATERIAL SETUP
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
    vertexShader:  VERT,
    fragmentShader: FRAG,
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
