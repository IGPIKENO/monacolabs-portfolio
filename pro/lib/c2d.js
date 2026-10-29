// Camada 2D→GPU: desenha num canvas 2D (determinístico a partir de t) e o envia como textura a um shader de tela cheia (1 draw call).
import { THREE, fullscreenTriangle, ORTHO } from './common.js';
const VS = `varying vec2 vUv; void main(){ vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }`;

/** layer(app, { frag, uniforms, scale }) → { cv, ctx, mat, w, h, dpr, begin(), render(t) }. O `frag` recebe tC (canvas), uRes, uTime, uAsp, vUv. */
export function layer(app, { frag, uniforms = {}, scale = 1, dprCap = 1.5 }) {
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VS, depthTest: false, depthWrite: false,
    uniforms: { tC: { value: tex }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uAsp: { value: 1 }, ...uniforms },
    fragmentShader: `precision highp float; uniform sampler2D tC; uniform vec2 uRes; uniform float uTime, uAsp; varying vec2 vUv;\n` + frag
  });
  const mesh = new THREE.Mesh(fullscreenTriangle(), mat); mesh.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(mesh);
  const L = { cv, ctx, mat, w: 1, h: 1, dpr: 1 };
  app.onResize((w, h, dpr) => {
    L.w = w; L.h = h; L.dpr = Math.min(dpr, dprCap) * scale;
    cv.width = Math.max(1, Math.round(w * L.dpr)); cv.height = Math.max(1, Math.round(h * L.dpr));
    mat.uniforms.uRes.value.set(w, h); mat.uniforms.uAsp.value = w / h;
  });
  L.begin = () => { ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0); ctx.clearRect(0, 0, L.w, L.h); };   // desenhe em pixels CSS
  L.render = t => { tex.needsUpdate = true; mat.uniforms.uTime.value = t; app.renderer.setRenderTarget(null); app.renderer.render(scene, ORTHO); };
  return L;
}

/** ponteiro em pixels CSS (y para baixo) a partir do ponteiro NDC do app */
export const px = (app, L) => ({ x: (app.pointer.x * .5 + .5) * L.w, y: (1 - (app.pointer.y * .5 + .5)) * L.h });
export const hash = (a, b = 0) => { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
