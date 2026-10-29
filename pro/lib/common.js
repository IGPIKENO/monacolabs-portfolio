// Núcleo compartilhado dos demos Pro: renderer, loop determinístico (seek/resume), ponteiro, painel stats.js e orçamento de performance.
import * as THREE from '../../vendor/three/build/three.module.js';
import Stats from '../../vendor/stats/Stats.js';
export { THREE };
export const TAU = Math.PI * 2, DURATION = 8;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const BUDGET = { fps: 60, calls: 20 };

// Hash determinístico (mulberry32) para dados sintéticos reproduzíveis
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Cria o app: canvas WebGL2, loop, HUD de métricas e API window.seek/resume/DURATION/__ready (usada pelo renderizador de vídeo). */
export function createApp({ maxDpr = 2, antialias = false, clear = 0x05060d, label = '' } = {}) {
  const host = document.getElementById('app') || document.body;
  const renderer = new THREE.WebGLRenderer({ antialias, powerPreference: 'high-performance', stencil: false, alpha: false });
  renderer.setClearColor(clear, 1);
  renderer.info.autoReset = false;
  host.appendChild(renderer.domElement);

  // --- erros de shader: registrados e exibidos no HUD ---
  const shaderErrors = []; window.__shaderErrors = shaderErrors;
  renderer.debug.onShaderError = (gl, prog, vs, fs) => {
    const log = (gl.getProgramInfoLog(prog) || '') + ' | VS: ' + (gl.getShaderInfoLog(vs) || '') + ' | FS: ' + (gl.getShaderInfoLog(fs) || '');
    shaderErrors.push(log); console.error('[shader]', log);
  };
  addEventListener('error', e => shaderErrors.push('js: ' + e.message));

  // --- painel de métricas (stats.js: FPS, ms e painel custom de draw calls) ---
  const stats = new Stats(); stats.showPanel(0);
  const dcPanel = stats.addPanel(new Stats.Panel('DC', '#ffb84d', '#2a1c05'));
  const perf = document.createElement('div'); perf.className = 'perf';
  const sw = document.createElement('div'); sw.className = 'stats';
  const sd = stats.dom; sd.style.cssText = 'position:static;display:flex;cursor:pointer;opacity:1;z-index:auto';
  // mostra FPS, ms e draw calls lado a lado (stats.js alterna por clique por padrão)
  [...sd.children].forEach(c => { c.style.display = 'block'; }); sd.style.pointerEvents = 'none';
  sw.appendChild(sd);
  const badge = document.createElement('div'); badge.className = 'badge';
  perf.append(sw, badge); document.body.appendChild(perf);

  const app = {
    renderer, stats, THREE, size: { w: 1, h: 1, dpr: 1 }, resizeHandlers: [], draw: null,
    maxDpr, calls: 0, callsMax: 0, label,
    onResize(f) { this.resizeHandlers.push(f); f(this.size.w, this.size.h, this.size.dpr); },
    pointer: createPointer(renderer.domElement)
  };

  function resize() {
    const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight), dpr = Math.min(devicePixelRatio || 1, app.maxDpr);
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
    app.size = { w, h, dpr }; app.resizeHandlers.forEach(f => f(w, h, dpr));
  }
  addEventListener('resize', resize);

  let seeked = null, t0 = performance.now(), last = t0, frames = 0, acc = 0, accN = 0;
  function tick(t, dt) {
    renderer.info.reset();
    app.pointer.update(t, dt);
    app.draw(t, dt);
    const calls = renderer.info.render.calls; app.calls = calls; app.callsMax = Math.max(app.callsMax, calls);
    dcPanel.update(calls, 40);
    if ((++frames % 12) === 1) {
      const ok = calls <= BUDGET.calls && shaderErrors.length === 0;
      badge.innerHTML = `${label ? label + ' · ' : ''}${Math.round(app.size.w * app.size.dpr)}×${Math.round(app.size.h * app.size.dpr)} · <b class="${calls > BUDGET.calls ? 'bad' : ''}">${calls}/${BUDGET.calls} calls</b> · ${renderer.info.render.triangles.toLocaleString('en-US')} tris · <b class="${shaderErrors.length ? 'bad' : ''}">${shaderErrors.length ? 'GLSL ERROR' : 'GLSL OK'}</b>`;
    }
  }
  function loop(now) {
    requestAnimationFrame(loop);
    if (seeked !== null) return;
    stats.begin();
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    tick((Math.max(0, now - t0) / 1000) % DURATION, dt);
    stats.end();
    // escala adaptativa: se a média ficar abaixo de ~50 fps, reduz a resolução interna (não afeta seek/vídeo)
    acc += dt; accN++;
    if (accN >= 45) { const avg = acc / accN; acc = 0; accN = 0; if (app.adapt) app.adapt(avg); }
  }
  app.start = draw => {
    app.draw = draw; resize(); tick(0, 0); window.__ready = true; requestAnimationFrame(loop);
  };
  window.DURATION = DURATION;
  window.seek = s => { seeked = ((s % DURATION) + DURATION) % DURATION; tick(seeked, 0); };
  window.resume = () => { if (seeked !== null) { t0 = performance.now() - seeked * 1000; last = performance.now(); seeked = null; } };
  window.__ready = false;
  return app;
}

/** Ponteiro: real (suavizado, 3 s de memória) ou cursor virtual periódico (loop de 8 s). Coordenadas NDC. */
export function createPointer(el) {
  const p = { x: 0, y: 0, vx: 0, vy: 0, down: false, real: false, _tx: 0, _ty: 0, _last: -1e9, _x: 0, _y: 0 };
  const set = e => { const r = el.getBoundingClientRect(); p._tx = ((e.clientX - r.left) / r.width) * 2 - 1; p._ty = -(((e.clientY - r.top) / r.height) * 2 - 1); p._last = performance.now(); };
  addEventListener('pointermove', set, { passive: true });
  el.addEventListener('pointerdown', e => { set(e); p.down = true; });
  addEventListener('pointerup', () => { p.down = false; });
  p.update = (t, dt) => {
    const real = performance.now() - p._last < 3000;
    const th = TAU * t / DURATION;
    const tx = real ? p._tx : 0.55 * Math.sin(th) + 0.12 * Math.sin(3 * th + 0.7);
    const ty = real ? p._ty : 0.38 * Math.sin(2 * th + 1.1);
    const k = dt === 0 ? 1 : 1 - Math.exp(-dt * 9);
    p.vx = (tx - p.x) * (dt === 0 ? 0 : 1 / Math.max(dt, 1e-3)); p.vy = (ty - p.y) * (dt === 0 ? 0 : 1 / Math.max(dt, 1e-3));
    p.x += (tx - p.x) * k; p.y += (ty - p.y) * k; p.real = real;
  };
  return p;
}

/** Triângulo de tela cheia (1 draw call) */
export function fullscreenTriangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}
export const ORTHO = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/** Cabeçalho HUD padrão */
export function hud({ eyebrow, title, text, tip }) {
  const d = document.createElement('div'); d.className = 'hud title';
  d.innerHTML = `<div class="eb">${eyebrow}</div><h1>${title}</h1><p>${text}</p>`; document.body.appendChild(d);
  if (tip) { const t = document.createElement('div'); t.className = 'hud tip'; t.textContent = tip; document.body.appendChild(t); }
}
