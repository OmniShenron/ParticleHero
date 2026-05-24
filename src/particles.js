import * as THREE from 'three';

// ── Constants derived from PLY analysis ──────────────────────────────────────
// Face radius in world units (after scale=2.245): ~1.554
// Particles MUST orbit OUTSIDE the face — they are a halo, not a cover

const N_SWARM   = 35000;
const R_EXCL    = 1.5;    // hard exclusion: particles cannot go inside this radius (face zone)
const R_SPAWN   = 2.6;    // initial spawn radius (well outside face at 1.554)
const R_MAX     = 3.4;    // boundary sphere
const ATTRACT   = 0.016;
const DAMPING   = 0.058;
const MAX_VEL   = 0.038;
const ORBIT     = 0.0048;

const N_NET     = 260;    // constellation nodes — also outside face
const R_NET     = 2.4;   // constellation orbit radius (outside face)
const LINK_D    = 0.30;
const MAX_SEG   = N_NET * 5;

// ── Palette ───────────────────────────────────────────────────────────────────
const PAL = [
  [0.00, 0.85, 1.00],
  [0.12, 0.55, 1.00],
  [0.18, 0.40, 1.00],
  [0.42, 0.18, 1.00],
  [0.72, 0.58, 1.00],
  [0.80, 0.92, 1.00],
];
function pickColor() {
  const [r,g,b] = PAL[Math.floor(Math.random() * PAL.length)];
  const t = 0.45 + Math.random() * 0.55;
  return [r*t, g*t, b*t];
}
function randSphere(r) {
  const u = Math.random(), v = Math.random();
  const theta = 2*Math.PI*u, phi = Math.acos(2*v-1);
  const s = r * (0.75 + Math.random() * 0.5);
  return [s*Math.sin(phi)*Math.cos(theta), s*Math.sin(phi)*Math.sin(theta), s*Math.cos(phi)];
}

// ── Swarm shaders ─────────────────────────────────────────────────────────────
const SW_VERT = /* glsl */`
  attribute float aRnd;
  attribute vec3  aCol;
  uniform   float uTime;
  uniform   float uOpacity;
  varying   vec3  vCol;
  varying   float vA;
  void main() {
    vec4 mvPos   = modelViewMatrix * vec4(position, 1.0);
    gl_Position  = projectionMatrix * mvPos;
    float cd     = max(0.1, -mvPos.z);
    gl_PointSize = clamp(mix(0.8, 2.8, aRnd) * (3.5/cd), 0.5, 7.0);
    vA   = (0.35 + 0.55 * sin(aRnd*6.283 + uTime*(1.0 + aRnd*1.5))) * uOpacity;
    vCol = aCol;
  }
`;
const SW_FRAG = /* glsl */`
  varying vec3  vCol;
  varying float vA;
  void main() {
    vec2  uv = gl_PointCoord - 0.5;
    float d  = length(uv);
    if (d > 0.5) discard;
    float soft = 1.0 - smoothstep(0.2, 0.5, d);
    float core = 1.0 - smoothstep(0.0, 0.18, d);
    gl_FragColor = vec4(vCol + core * 0.3, (soft*0.7 + core*0.3) * vA);
  }
`;

// ── Line shaders ──────────────────────────────────────────────────────────────
const LN_VERT = /* glsl */`
  attribute float aLA;
  varying   float vLA;
  void main() {
    vLA = aLA;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const LN_FRAG = /* glsl */`
  uniform float uOpacity;
  varying float vLA;
  void main() {
    if (vLA < 0.005) discard;
    gl_FragColor = vec4(0.08, 0.55, 1.0, vLA * 0.45 * uOpacity);
  }
`;

// ── createSwarm ───────────────────────────────────────────────────────────────
export function createSwarm(scene) {
  const geo  = new THREE.BufferGeometry();
  const pos  = new Float32Array(N_SWARM * 3);
  const rnd  = new Float32Array(N_SWARM);
  const col  = new Float32Array(N_SWARM * 3);
  const vel  = new Float32Array(N_SWARM * 3);

  for (let i = 0; i < N_SWARM; i++) {
    // Spawn OUTSIDE face exclusion zone
    const [x,y,z] = randSphere(R_SPAWN);
    pos[i*3]=x; pos[i*3+1]=y; pos[i*3+2]=z;
    rnd[i] = Math.random();
    const [r,g,b] = pickColor();
    col[i*3]=r; col[i*3+1]=g; col[i*3+2]=b;
    const len = Math.sqrt(x*x+y*y+z*z)+.001;
    const spd = 0.003 + Math.random()*0.005;
    vel[i*3]   = -z/len*spd;
    vel[i*3+2] =  x/len*spd;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aRnd',     new THREE.BufferAttribute(rnd, 1));
  geo.setAttribute('aCol',     new THREE.BufferAttribute(col, 3));

  const mat = new THREE.ShaderMaterial({
    vertexShader: SW_VERT, fragmentShader: SW_FRAG,
    uniforms: { uTime:{value:0}, uOpacity:{value:1} },
    blending: THREE.AdditiveBlending, depthWrite:false, transparent:true,
  });

  const mesh = new THREE.Points(geo, mat);
  scene.add(mesh);
  return { mesh, geo, vel, mat };
}

// ── updateSwarm ───────────────────────────────────────────────────────────────
export function updateSwarm(sw, mouse, dt) {
  const { geo, vel, mat } = sw;
  const pos = geo.attributes.position.array;
  const d   = Math.min(dt, 0.05);
  mat.uniforms.uTime.value += d;

  const tx=mouse.x, ty=mouse.y, tz=mouse.z;

  for (let i = 0; i < N_SWARM; i++) {
    const i3 = i*3;
    const px=pos[i3], py=pos[i3+1], pz=pos[i3+2];

    const dx=tx-px, dy=ty-py, dz=tz-pz;
    const dist = Math.sqrt(dx*dx+dy*dy+dz*dz)+.01;
    const f = ATTRACT/(1.0+dist*0.9);
    let vx=vel[i3]+dx/dist*f, vy=vel[i3+1]+dy/dist*f, vz=vel[i3+2]+dz/dist*f;

    // Orbit
    const pLen = Math.sqrt(px*px+py*py+pz*pz)+.001;
    vx += -pz/pLen*ORBIT;
    vz +=  px/pLen*ORBIT;

    // ── KEY FIX: EXCLUSION ZONE — push particles OUT of face region ──────────
    if (pLen < R_EXCL) {
      const strength = (R_EXCL - pLen) / R_EXCL * 0.06;
      vx += (px/pLen) * strength;
      vy += (py/pLen) * strength;
      vz += (pz/pLen) * strength;
    }

    // Radial restore toward R_SPAWN
    const radErr = pLen - R_SPAWN;
    vx -= px/pLen*radErr*0.0015;
    vy -= py/pLen*radErr*0.0015;
    vz -= pz/pLen*radErr*0.0015;

    const spd = Math.sqrt(vx*vx+vy*vy+vz*vz);
    if (spd > MAX_VEL) { const s=MAX_VEL/spd; vx*=s; vy*=s; vz*=s; }
    vx*=1-DAMPING; vy*=1-DAMPING; vz*=1-DAMPING;
    vel[i3]=vx; vel[i3+1]=vy; vel[i3+2]=vz;

    pos[i3]   += vx*d*60;
    pos[i3+1] += vy*d*60;
    pos[i3+2] += vz*d*60;

    // Hard boundary
    const nLen = Math.sqrt(pos[i3]**2+pos[i3+1]**2+pos[i3+2]**2);
    if (nLen > R_MAX) {
      const sc=R_SPAWN/nLen;
      pos[i3]*=sc; pos[i3+1]*=sc; pos[i3+2]*=sc;
      vel[i3]=vel[i3+1]=vel[i3+2]=0;
    }
  }
  geo.attributes.position.needsUpdate = true;
}

// ── createNet ─────────────────────────────────────────────────────────────────
export function createNet(scene) {
  const nPos   = new Float32Array(N_NET * 3);
  const nVel   = new Float32Array(N_NET * 3);
  const nPhase = new Float32Array(N_NET);

  for (let i = 0; i < N_NET; i++) {
    // Constellation nodes also orbit outside face
    const [x,y,z] = randSphere(R_NET);
    nPos[i*3]=x; nPos[i*3+1]=y; nPos[i*3+2]=z;
    const len=Math.sqrt(x*x+y*y+z*z)+.001, s=0.001+Math.random()*0.0015;
    nVel[i*3]  =-z/len*s;
    nVel[i*3+2]= x/len*s;
    nPhase[i]  = Math.random()*Math.PI*2;
  }

  const lPos = new Float32Array(MAX_SEG * 2 * 3);
  const lA   = new Float32Array(MAX_SEG * 2);
  const geo  = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(lPos, 3));
  geo.setAttribute('aLA',      new THREE.BufferAttribute(lA,   1));

  const mat = new THREE.ShaderMaterial({
    vertexShader:LN_VERT, fragmentShader:LN_FRAG,
    uniforms:{ uOpacity:{value:1} },
    blending:THREE.AdditiveBlending, depthWrite:false, transparent:true,
  });

  const mesh = new THREE.LineSegments(geo, mat);
  scene.add(mesh);
  return { mesh, geo, mat, nPos, nVel, nPhase };
}

// ── updateNet ─────────────────────────────────────────────────────────────────
export function updateNet(net, mouse, t, dt) {
  const { geo, mat, nPos, nVel, nPhase } = net;
  const d=Math.min(dt,0.05);
  const tx=mouse.x, ty=mouse.y, tz=mouse.z;

  for (let i=0; i<N_NET; i++) {
    const i3=i*3;
    const px=nPos[i3], py=nPos[i3+1], pz=nPos[i3+2];
    const dx=tx-px, dy=ty-py, dz=tz-pz;
    const dist=Math.sqrt(dx*dx+dy*dy+dz*dz)+.01;
    const f=0.002/(1+dist*1.3);
    nVel[i3]  +=dx/dist*f; nVel[i3+1]+=dy/dist*f; nVel[i3+2]+=dz/dist*f;
    const pLen=Math.sqrt(px*px+py*py+pz*pz)+.001;
    nVel[i3]  +=-pz/pLen*0.0009;
    nVel[i3+2]+= px/pLen*0.0009;
    // Keep net nodes outside face too
    if (pLen < R_EXCL) {
      const s=(R_EXCL-pLen)/R_EXCL*0.04;
      nVel[i3]+=px/pLen*s; nVel[i3+1]+=py/pLen*s; nVel[i3+2]+=pz/pLen*s;
    }
    const radErr=pLen-R_NET;
    nVel[i3]  -=px/pLen*radErr*0.002;
    nVel[i3+1]-=py/pLen*radErr*0.002;
    nVel[i3+2]-=pz/pLen*radErr*0.002;
    nVel[i3]*=0.96; nVel[i3+1]*=0.96; nVel[i3+2]*=0.96;
    nPos[i3]  +=nVel[i3]  *d*60;
    nPos[i3+1]+=nVel[i3+1]*d*60;
    nPos[i3+2]+=nVel[i3+2]*d*60;
  }

  const lp=geo.attributes.position.array;
  const la=geo.attributes.aLA.array;
  let seg=0;
  for (let i=0; i<N_NET && seg<MAX_SEG; i++) {
    const ax=nPos[i*3], ay=nPos[i*3+1], az=nPos[i*3+2];
    for (let j=i+1; j<N_NET && seg<MAX_SEG; j++) {
      const bx=nPos[j*3], by=nPos[j*3+1], bz=nPos[j*3+2];
      const dist=Math.sqrt((bx-ax)**2+(by-ay)**2+(bz-az)**2);
      if (dist<LINK_D) {
        const alpha=(1-dist/LINK_D)*(0.5+0.5*Math.sin(t*1.3+nPhase[i]+nPhase[j]));
        const v6=seg*6, v2=seg*2;
        lp[v6]=ax;lp[v6+1]=ay;lp[v6+2]=az;
        lp[v6+3]=bx;lp[v6+4]=by;lp[v6+5]=bz;
        la[v2]=alpha;la[v2+1]=alpha;
        seg++;
      }
    }
  }
  for (let k=seg;k<MAX_SEG;k++){
    lp[k*6]=lp[k*6+1]=lp[k*6+2]=lp[k*6+3]=lp[k*6+4]=lp[k*6+5]=0;
    la[k*2]=la[k*2+1]=0;
  }
  geo.attributes.position.needsUpdate=true;
  geo.attributes.aLA.needsUpdate=true;
  geo.setDrawRange(0,seg*2);
}
