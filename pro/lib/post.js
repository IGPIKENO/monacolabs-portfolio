// Pós-processamento próprio (sem dependências): bloom duplo em cadeia de mips (13-tap down / tent up) + aberração cromática + ACES + vinheta + grão.
// Custo fixo: 5 downs + 4 ups + 1 composição = 10 draw calls (+ a cena).
import { THREE, fullscreenTriangle, ORTHO } from './common.js';

const VS = /* glsl */`varying vec2 vUv; void main(){ vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }`;

const FS_DOWN = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uPre, uThr, uKnee; varying vec2 vUv;
vec3 pf(vec3 c){ if (uPre < .5) return c; c = min(c, vec3(40.)); float br = max(c.r, max(c.g, c.b)); float s = clamp(br - uThr + uKnee, 0., 2. * uKnee); s = s * s / (4. * uKnee + 1e-4); return c * (max(s, br - uThr) / max(br, 1e-4)); }
vec3 T(vec2 o){ return pf(texture2D(tSrc, vUv + uTexel * o).rgb); }
void main(){
  vec3 e = T(vec2(0.));
  vec3 a = T(vec2(-2., 2.)), b = T(vec2(0., 2.)), c = T(vec2(2., 2.)), d = T(vec2(-2., 0.)), f = T(vec2(2., 0.)), g = T(vec2(-2., -2.)), h = T(vec2(0., -2.)), i = T(vec2(2., -2.));
  vec3 j = T(vec2(-1., 1.)), k = T(vec2(1., 1.)), l = T(vec2(-1., -1.)), m = T(vec2(1., -1.));
  vec3 r = e * .125 + (a + c + g + i) * .03125 + (b + d + f + h) * .0625 + (j + k + l + m) * .125;
  gl_FragColor = vec4(r, 1.);
}`;

const FS_UP = /* glsl */`
uniform sampler2D tLow, tHigh; uniform vec2 uTexel; uniform float uRadius; varying vec2 vUv;
void main(){
  vec2 o = uTexel * uRadius;
  vec3 s = texture2D(tLow, vUv).rgb * 4.
    + (texture2D(tLow, vUv + vec2(o.x, 0.)).rgb + texture2D(tLow, vUv - vec2(o.x, 0.)).rgb + texture2D(tLow, vUv + vec2(0., o.y)).rgb + texture2D(tLow, vUv - vec2(0., o.y)).rgb) * 2.
    + texture2D(tLow, vUv + o).rgb + texture2D(tLow, vUv - o).rgb + texture2D(tLow, vUv + vec2(o.x, -o.y)).rgb + texture2D(tLow, vUv + vec2(-o.x, o.y)).rgb;
  gl_FragColor = vec4(texture2D(tHigh, vUv).rgb + s / 16., 1.);
}`;

const FS_COMP = /* glsl */`
uniform sampler2D tScene, tB0, tB1; uniform vec2 uRes;
uniform float uBT, uBW, uCA, uVig, uGrain, uExp, uTime, uTone; varying vec2 vUv;
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.); }
vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(max(c, 0.), vec3(1. / 2.4)) - .055, step(.0031308, c)); }
void main(){
  vec2 d = vUv - .5; float r2 = dot(d, d); vec2 off = d * uCA * (1. + r2 * 3.);
  vec3 col = vec3(texture2D(tScene, vUv + off).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - off).b);
  vec3 b0 = vec3(texture2D(tB0, vUv + off * .5).r, texture2D(tB0, vUv).g, texture2D(tB0, vUv - off * .5).b);
  col += b0 * uBT + texture2D(tB1, vUv).rgb * uBW;
  col *= uExp;
  col = uTone > .5 ? aces(col) : clamp(col, 0., 1.);
  col *= 1. - uVig * smoothstep(.12, .62, r2 * 2.4);
  col += (hash(vUv * uRes + fract(uTime) * 91.7) - .5) * uGrain;
  gl_FragColor = vec4(srgb(col), 1.);
}`;

export class Post {
  constructor(renderer, params = {}) {
    this.r = renderer;
    this.p = Object.assign({ scale: 1, threshold: 1.0, knee: .6, bloomTight: .55, bloomWide: .9, radius: 1.0, ca: .0025, vignette: .35, grain: .018, exposure: 1.0, tone: 1 }, params);
    this.mesh = new THREE.Mesh(fullscreenTriangle(), null); this.mesh.frustumCulled = false;
    this.fs = new THREE.Scene(); this.fs.add(this.mesh);
    const mk = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
    this.mDown = mk(FS_DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uPre: { value: 1 }, uThr: { value: 1 }, uKnee: { value: .5 } });
    this.mUp = mk(FS_UP, { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } });
    this.mComp = mk(FS_COMP, { tScene: { value: null }, tB0: { value: null }, tB1: { value: null }, uRes: { value: new THREE.Vector2() }, uBT: { value: 0 }, uBW: { value: 0 }, uCA: { value: 0 }, uVig: { value: 0 }, uGrain: { value: 0 }, uExp: { value: 1 }, uTime: { value: 0 }, uTone: { value: 1 } });
    const rt = (w, h, o = {}) => new THREE.WebGLRenderTarget(w, h, Object.assign({ type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false }, o));
    this._rt = rt; this.scene = null; this.down = []; this.up = [];
    this.setSize(2, 2, 1);
  }
  setSize(w, h, dpr) {
    const pw = Math.max(2, Math.floor(w * dpr)), ph = Math.max(2, Math.floor(h * dpr));
    this.full = [pw, ph]; this._build();
  }
  setScale(s) { this.p.scale = s; this._build(); }
  _build() {
    const [pw, ph] = this.full, s = this.p.scale, sw = Math.max(2, Math.floor(pw * s)), sh = Math.max(2, Math.floor(ph * s));
    this.scene?.dispose(); this.down.forEach(t => t.dispose()); this.up.forEach(t => t.dispose());
    this.scene = this._rt(sw, sh, { depthBuffer: true, samples: s >= .99 ? 4 : 0 });
    this.down = []; this.up = [];
    for (let i = 0; i < 5; i++) { const w = Math.max(2, sw >> (i + 1)), h = Math.max(2, sh >> (i + 1)); this.down.push(this._rt(w, h)); if (i < 4) this.up.push(this._rt(w, h)); }
    this.mComp.uniforms.uRes.value.set(pw, ph);
  }
  /** Renderiza `scene` com `camera` no alvo HDR e aplica o pipeline até a tela. */
  render(scene, camera, time = 0) {
    const r = this.r;
    r.setRenderTarget(this.scene); r.clear(); r.render(scene, camera);
    this.bloomAndComposite(time);
  }
  /** Para cenas já desenhadas em this.scene (ex.: raymarching em triângulo de tela cheia) */
  bloomAndComposite(time) {
    const r = this.r, p = this.p, U = this.mDown.uniforms;
    this.mesh.material = this.mDown; U.uThr.value = p.threshold; U.uKnee.value = p.knee;
    let src = this.scene;
    for (let i = 0; i < 5; i++) {
      U.tSrc.value = src.texture; U.uTexel.value.set(1 / src.width, 1 / src.height); U.uPre.value = i === 0 ? 1 : 0;
      r.setRenderTarget(this.down[i]); r.render(this.fs, ORTHO); src = this.down[i];
    }
    this.mesh.material = this.mUp; const V = this.mUp.uniforms; V.uRadius.value = p.radius;
    let low = this.down[4];
    for (let i = 3; i >= 0; i--) {
      V.tLow.value = low.texture; V.tHigh.value = this.down[i].texture; V.uTexel.value.set(1 / low.width, 1 / low.height);
      r.setRenderTarget(this.up[i]); r.render(this.fs, ORTHO); low = this.up[i];
    }
    this.mesh.material = this.mComp; const C = this.mComp.uniforms;
    C.tScene.value = this.scene.texture; C.tB0.value = this.up[0].texture; C.tB1.value = this.up[2].texture;
    C.uBT.value = p.bloomTight; C.uBW.value = p.bloomWide; C.uCA.value = p.ca; C.uVig.value = p.vignette; C.uGrain.value = p.grain; C.uExp.value = p.exposure; C.uTime.value = time; C.uTone.value = p.tone;
    r.setRenderTarget(null); r.render(this.fs, ORTHO);
  }
}
