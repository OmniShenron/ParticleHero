import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
gsap.registerPlugin(ScrollTrigger);

export function setupScroll({ camera, bloom, face }) {
  const initCamZ  = camera.position.z;   // 3.5
  const initBloom = bloom.intensity;     // 2.2

  const proxy = {
    camZ:   initCamZ,
    faceOp: 1.0,
    bloomI: initBloom,
  };

  function apply() {
    camera.position.z = proxy.camZ;
    camera.lookAt(0, 0, 0);
    face.mat.uniforms.uOpacity.value = proxy.faceOp;
    bloom.intensity = proxy.bloomI;
  }

  gsap.timeline({
    scrollTrigger: {
      trigger:      '#hero',
      start:        'top top',
      end:          'bottom top',
      scrub:        2.8,
      pin:          true,
      anticipatePin: 1,
    },
  })
  .to(proxy, {
    camZ:   1.4,
    faceOp: 0.0,
    bloomI: 0.0,
    duration: 1,
    ease: 'power2.inOut',
    onUpdate: apply,
  }, 0);

  ScrollTrigger.create({
    trigger:    '#hero',
    start:      'top top',
    onEnterBack() {
      proxy.camZ   = initCamZ;
      proxy.faceOp = 1.0;
      proxy.bloomI = initBloom;
      apply();
    },
  });
}
