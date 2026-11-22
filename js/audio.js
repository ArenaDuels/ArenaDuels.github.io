// Sound effects, all made in the browser with the Web Audio API: no audio files to download.
//
//   - the LASER GUN: a deep plasma rumble that runs while a trigger is held. Yours is plain; other
//     players' beams are placed in 3D, so you hear which way they are and how far.
//   - the LASER HIT: an electric-arc sizzle (buzzing, stuttering crackle) that runs while YOUR
//     beam is on someone.
//   - DEATH: one sound for everyone, a power-down: a buzzing tone slows like a stopping tape, with a
//     deep boom and sparks. For other players it comes from where they died.
//
// Browsers only allow sound once the person has clicked or pressed a key, so call unlock() from an
// input event. Everything is silent (and harmless) until then.

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ---- making the sizzle and the sparks (once, when sound is unlocked) ----
// A small filter: kind is "lowpass", "highpass" or "bandpass" (Q as in the audio-EQ cookbook).
function biquad(kind, f, Q, sr) {
  const w0 = 2 * Math.PI * Math.min(f, sr * 0.45) / sr;
  const alpha = Math.sin(w0) / (2 * Q);
  const cw = Math.cos(w0);
  let b0, b1, b2;
  if (kind === "lowpass") { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
  else if (kind === "highpass") { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
  else { b0 = alpha; b1 = 0; b2 = -alpha; }
  const a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
  return (x) => {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  };
}

const whiteNoise = (n) => { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = Math.random() * 2 - 1; return x; };

// A value that wanders smoothly between lo and hi, changing about `rate` times a second.
function slowNoise(n, sr, rate, lo, hi) {
  const pts = new Float32Array(Math.ceil((n / sr) * rate) + 3);
  for (let i = 0; i < pts.length; i++) pts[i] = Math.random();
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = (i / sr) * rate, i0 = Math.floor(p), f = p - i0;
    out[i] = lo + (hi - lo) * (pts[i0] * (1 - f) + pts[i0 + 1] * f);
  }
  return out;
}

// The electric-arc sizzle: a buzz (noise chopped 100 times a second, breaking up and stuttering)
// with random crackles over it. A loop, 2.5 s, so the 50 Hz buzz fits a whole number of times.
export function makeSizzleSamples(sr, seconds = 2.5) {
  const n = Math.floor(sr * seconds);
  const buzzNoise = biquad("bandpass", 2200, 0.5, sr)(whiteNoise(n));
  const wander = slowNoise(n, sr, 14, 0.25, 1.0);
  const gateRaw = slowNoise(n, sr, 9, 0, 1);
  for (let i = 0; i < n; i++) gateRaw[i] = gateRaw[i] > 0.18 ? 1 : 0;
  const gate = biquad("lowpass", 200, 0.707, sr)(gateRaw);   // so it breaks up smoothly, not with clicks
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const am = 0.35 + 0.65 * Math.abs(Math.sin(Math.PI * 100 * (i / sr)));
    out[i] = buzzNoise[i] * am * wander[i] * 0.6 * gate[i];
  }
  // crackles: tiny sharp ticks, and now and then a bigger, lower pop
  const rate = slowNoise(n, sr, 3, 40, 140);
  let t = 0;
  for (;;) {
    t += -Math.log(1 - Math.random()) * (sr / rate[Math.min(Math.floor(t), n - 1)]);
    const i = Math.floor(t);
    if (i >= n) break;
    let burst, amp;
    if (Math.random() < 0.12) {
      const L = Math.floor(0.007 * sr);
      burst = biquad("lowpass", 1800, 0.707, sr)(whiteNoise(L));
      for (let k = 0; k < L; k++) burst[k] *= Math.exp(-k / (0.0025 * sr)) * 1.6;
      amp = 0.3 + 0.6 * Math.random();
    } else {
      const L = Math.floor(0.003 * sr);
      burst = biquad("lowpass", 9000, 0.707, sr)(biquad("highpass", 2000, 0.707, sr)(whiteNoise(L)));
      for (let k = 0; k < L; k++) burst[k] *= Math.exp(-k / (0.0007 * sr));
      amp = Math.random() ** 3 * 0.95 + 0.03;
    }
    const sign = Math.random() < 0.5 ? -1 : 1;
    for (let k = 0; k < burst.length && i + k < n; k++) out[i + k] += burst[k] * amp * sign * 1.2;
  }
  // make the loop seamless: fade the end into the start
  const f = Math.floor(0.04 * sr);
  for (let k = 0; k < f; k++) { const r = k / f; out[k] = out[k] * r + out[n - f + k] * (1 - r); }
  return out.subarray(0, n - f);
}

// Sparks for the death sound: bright noise that flickers on and off. 3 s; each death plays a bit of it.
export function makeSparkSamples(sr, seconds = 3) {
  const n = Math.floor(sr * seconds);
  const hiss = biquad("highpass", 2500, 0.707, sr)(whiteNoise(n));
  const flicker = slowNoise(n, sr, 40, 0, 1);
  for (let i = 0; i < n; i++) hiss[i] *= flicker[i] ** 4;
  return hiss;
}

export class Sfx {
  constructor(AudioCtor = globalThis.AudioContext || globalThis.webkitAudioContext) {
    this.AudioCtor = AudioCtor;
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.sizzle = null;      // the looping sizzle
    this.sparks = null;      // sparks for the death sound
    this.volume = 0.6;      // 0..1, from the settings slider
    this.voices = new Set(); // the running beam and hit sounds, so silence() can stop them all
  }

  get ready() {
    return !!this.ctx;
  }

  // Call from a click or key press. Safe to call as often as you like.
  unlock() {
    if (!this.AudioCtor) return false;
    if (!this.ctx) {
      this.ctx = new this.AudioCtor({ latencyHint: "interactive" });
      // everything goes through a limiter so a lot of beams at once can't clip
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -14;
      limiter.knee.value = 12;
      limiter.ratio.value = 6;
      limiter.attack.value = 0.004;
      limiter.release.value = 0.15;
      limiter.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume ** 2;
      this.master.connect(limiter);
      // two seconds of white noise, shared by every sound that needs hiss
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      // the sizzle loop and the death sparks, worked out once
      const sizzle = makeSizzleSamples(this.ctx.sampleRate);
      this.sizzle = this.ctx.createBuffer(1, sizzle.length, this.ctx.sampleRate);
      this.sizzle.getChannelData(0).set(sizzle);
      const sparks = makeSparkSamples(this.ctx.sampleRate);
      this.sparks = this.ctx.createBuffer(1, sparks.length, this.ctx.sampleRate);
      this.sparks.getChannelData(0).set(sparks);
    }
    if (this.ctx.state === "suspended") this.ctx.resume?.();
    return true;
  }

  // 0..1. Squared, because loudness is not heard in a straight line.
  setVolume(v) {
    this.volume = clamp01(v);
    if (this.master) this.master.gain.setTargetAtTime(this.volume ** 2, this.ctx.currentTime, 0.02);
  }

  // Where the player is and which way they face, so 3D sounds come from the right side.
  setListener(pos, forward) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
      l.forwardX.value = forward.x; l.forwardY.value = forward.y; l.forwardZ.value = forward.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  // A held laser gun. positional=true for other players' guns (placed in 3D with setPosition).
  beamVoice(positional = false) {
    const v = new BeamVoice(this, positional);
    this.voices.add(v);
    return v;
  }

  // The sizzle while your beam is on a target.
  hitVoice() {
    const v = new HitVoice(this);
    this.voices.add(v);
    return v;
  }

  // The death sound, the same for everyone: a power-down. A buzzing tone slows like a stopping tape
  // (the pitch falls slowly at first, then faster), with a deep boom and sparks. `position`
  // ({x,y,z}) places it in 3D, for other players; leave it out for your own.
  death({ position = null } = {}) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const D = 1.35; // how long the tone takes to wind down
    const out = c.createGain();
    out.gain.value = position ? 0.9 : 1.0;
    const tail = this._place(out, position, 5);
    tail.connect(this.master);

    // the tape-stop: a pitch curve that falls slowly then fast
    const pitch = (mult) => {
      const curve = new Float32Array(96);
      for (let i = 0; i < curve.length; i++) curve[i] = (380 * (1 - (i / (curve.length - 1)) ** 1.7) + 16) * mult;
      return curve;
    };
    const sources = [];
    const mix = c.createGain();
    for (const [type, mult, level] of [["sawtooth", 1, 1], ["sawtooth", 1.012, 0.8], ["square", 0.5, 0.5]]) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.setValueCurveAtTime(pitch(mult), t, D);
      o.frequency.setValueAtTime(16 * mult, t + D);
      const g = c.createGain();
      g.gain.value = level;
      o.connect(g); g.connect(mix);
      sources.push(o);
    }
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(2200, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + D);
    // a wobble that slows as it dies
    const flutter = c.createGain();
    flutter.gain.value = 0.85;
    const lfo = c.createOscillator();
    lfo.type = "sine";
    lfo.frequency.setValueAtTime(17, t);
    lfo.frequency.exponentialRampToValueAtTime(3.5, t + D);
    const lfoDepth = c.createGain();
    lfoDepth.gain.value = 0.15;
    lfo.connect(lfoDepth); lfoDepth.connect(flutter.gain);
    sources.push(lfo);
    const amp = c.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.32, t + 0.02);
    amp.gain.setValueAtTime(0.32, t + 1.0);
    amp.gain.linearRampToValueAtTime(0, t + 1.5);
    mix.connect(lp); lp.connect(flutter); flutter.connect(amp); amp.connect(out);

    // the boom as it goes
    const boom = c.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(95, t);
    boom.frequency.exponentialRampToValueAtTime(28, t + 0.55);
    const boomGain = c.createGain();
    boomGain.gain.setValueAtTime(0, t);
    boomGain.gain.linearRampToValueAtTime(0.95, t + 0.01);
    boomGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    boom.connect(boomGain); boomGain.connect(out);
    sources.push(boom);

    // sparks on the way down
    const sparks = c.createBufferSource();
    sparks.buffer = this.sparks;
    const sparkGain = c.createGain();
    sparkGain.gain.setValueAtTime(0.35, t);
    sparkGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    sparks.connect(sparkGain); sparkGain.connect(out);

    const end = t + 1.7;
    for (const s of sources) { s.start(t); s.stop(end); }
    sparks.start(t, Math.random() * 2, 0.9);
    sparks.stop(end);
    boom.onended = () => { try { out.disconnect(); tail.disconnect(); } catch { /* already gone */ } };
  }

  // A short burst of the laser, so the volume slider can be heard as it moves.
  preview() {
    if (!this.ctx) return;
    const v = new BeamVoice(this, false);
    v.start();
    setTimeout(() => v.stop(), 250);
  }

  // Stop every running beam and hit sound (leaving a match, pausing).
  silence() {
    for (const v of this.voices) v.stop();
  }

  // Put `node`'s output in 3D if there is a position, else straight through. Returns the last node.
  _place(node, position, refDistance) {
    if (!position) return node;
    const panner = this.ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = refDistance;
    panner.rolloffFactor = 1.3;
    panner.maxDistance = 120;
    setPannerPosition(panner, position.x, position.y, position.z);
    node.connect(panner);
    return panner;
  }
}

function setPannerPosition(panner, x, y, z) {
  if (panner.positionX) {
    panner.positionX.value = x; panner.positionY.value = y; panner.positionZ.value = z;
  } else {
    panner.setPosition(x, y, z);
  }
}

// A sound that runs while something is held: start() and stop() can be called every frame.
class LoopVoice {
  constructor(sfx) {
    this.sfx = sfx;
    this.active = false;
    this.nodes = null;
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    const { sfx } = this;
    const n = this.nodes;
    this.nodes = null;
    if (!n || !sfx.ctx) return;
    const t = sfx.ctx.currentTime;
    n.out.gain.cancelScheduledValues(t);
    n.out.gain.setValueAtTime(n.out.gain.value, t);
    n.out.gain.linearRampToValueAtTime(0, t + 0.07);
    for (const s of n.sources) s.stop(t + 0.1);
    n.sources[0].onended = () => { try { n.tail.disconnect(); n.out.disconnect(); } catch { /* already gone */ } };
  }

  dispose() {
    this.stop();
    this.sfx.voices.delete(this);
  }
}

class BeamVoice extends LoopVoice {
  constructor(sfx, positional) {
    super(sfx);
    this.positional = positional;
    this.position = { x: 0, y: 0, z: 0 };
    this.panner = null;
  }

  setPosition(x, y, z) {
    this.position = { x, y, z };
    if (this.panner) setPannerPosition(this.panner, x, y, z);
  }

  // A deep plasma rumble: a low growl (two saws and a square an octave down, through a low-pass,
  // pulsing 21 times a second) with a low rush of air under it.
  start() {
    if (this.active || !this.sfx.ctx) return;
    this.active = true;
    const sfx = this.sfx;
    const c = sfx.ctx;
    const t = c.currentTime;

    const out = c.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(this.positional ? 1.25 : 0.75, t + 0.03);
    const tail = sfx._place(out, this.positional ? this.position : null, 4);
    this.panner = tail === out ? null : tail;
    tail.connect(sfx.master);

    const growl = c.createGain();   // everything in the growl, before the low-pass
    const osc = (type, freq, level) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = c.createGain();
      g.gain.value = level;
      o.connect(g); g.connect(growl);
      return o;
    };
    const saw1 = osc("sawtooth", 62, 1);
    const saw2 = osc("sawtooth", 93.5, 0.6);
    const sub = osc("square", 31, 0.5);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 520;
    lp.Q.value = 3.5;               // dB
    const pulse = c.createGain();   // the 21 Hz pulsing
    pulse.gain.value = 0.75;
    const lfo = c.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 21;
    const lfoDepth = c.createGain();
    lfoDepth.gain.value = 0.25;
    lfo.connect(lfoDepth); lfoDepth.connect(pulse.gain);
    const body = c.createGain();
    body.gain.value = 0.5;
    growl.connect(lp); lp.connect(pulse); pulse.connect(body); body.connect(out);

    const air = c.createBufferSource();
    air.buffer = sfx.noise;
    air.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 420;
    bp.Q.value = 0.6;
    const airGain = c.createGain();
    airGain.gain.value = 0.25;
    air.connect(bp); bp.connect(airGain); airGain.connect(out);

    // (the noise starts at a random point so several beams don't hiss in step)
    for (const s of [saw1, saw2, sub, lfo]) s.start(t);
    air.start(t, Math.random() * 1.5);
    this.nodes = { out, tail, sources: [saw1, saw2, sub, lfo, air] };
  }
}

class HitVoice extends LoopVoice {
  // The electric-arc sizzle, looped.
  start() {
    if (this.active || !this.sfx.ctx) return;
    this.active = true;
    const sfx = this.sfx;
    const c = sfx.ctx;
    const t = c.currentTime;
    const out = c.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1.8, t + 0.01);
    out.connect(sfx.master);
    const loop = c.createBufferSource();
    loop.buffer = sfx.sizzle;
    loop.loop = true;
    loop.connect(out);
    loop.start(t, Math.random() * (loop.buffer.duration || 1));
    this.nodes = { out, tail: out, sources: [loop] };
  }
}
