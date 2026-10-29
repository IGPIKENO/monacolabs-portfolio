// Botão "Sound" + contexto Web Audio sob gesto do usuário. O áudio é 100% sintetizado (sem amostras); todo som segue o mesmo tempo t da imagem.
export function sound() {
  const b = document.createElement('button'); b.id = 'snd'; b.type = 'button'; b.textContent = 'Sound: off'; document.body.appendChild(b);
  const S = { on: false, ctx: null, out: null, onstart() {}, onstop() {} };
  b.addEventListener('click', () => {
    if (!S.on) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)(); ctx.resume();
      const out = ctx.createGain(); out.gain.value = 0; const comp = ctx.createDynamicsCompressor(); out.connect(comp); comp.connect(ctx.destination);
      out.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 1.2); Object.assign(S, { on: true, ctx, out });
      S.onstart(ctx, out); b.textContent = 'Sound: on'; b.classList.add('on');
    } else {
      const { ctx, out } = S; S.on = false; S.onstop(); out.gain.setTargetAtTime(0, ctx.currentTime, 0.15); setTimeout(() => ctx.close(), 700);
      b.textContent = 'Sound: off'; b.classList.remove('on');
    }
  });
  window.__audio = () => ({ running: S.on, state: S.ctx && S.ctx.state });
  return S;
}
/** reverb por ruído filtrado com decaimento exponencial */
export function reverb(ctx, sec = 3.2) {
  const n = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); let lp = 0; for (let i = 0; i < n; i++) { lp += ((Math.random() * 2 - 1) - lp) * 0.4; d[i] = lp * Math.pow(1 - i / n, 3); } }
  const conv = ctx.createConvolver(); conv.buffer = buf; return conv;
}
