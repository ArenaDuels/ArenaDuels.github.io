// Sound effects: checked against a fake audio device (no speakers needed): every sound that starts also stops.
import test from "node:test";
import assert from "node:assert/strict";
import { Sfx, makeSizzleSamples, makeSparkSamples } from "../js/audio.js";

function makeFakeAudio({ modernListener = true, modernPanner = true } = {}) {
  const log = { sources: [], panners: [], nodes: 0 };
  const param = (v = 0) => ({
    value: v, setValueAtTime(x) { this.value = x; }, linearRampToValueAtTime(x) { this.value = x; },
    exponentialRampToValueAtTime(x) { this.value = x; }, setValueCurveAtTime() {}, setTargetAtTime(x) { this.target = x; }, cancelScheduledValues() {},
  });
  const node = (extra = {}) => { log.nodes++; return { connect: (n) => n, disconnect() {}, ...extra }; };
  const source = (extra = {}) => {
    const s = node({ started: 0, stopped: 0, start() { this.started++; }, stop() { this.stopped++; }, onended: null, ...extra });
    log.sources.push(s);
    return s;
  };
  class FakeAudioContext {
    constructor() {
      this.currentTime = 0; this.sampleRate = 8000; this.state = "suspended"; this.destination = node();
      this.listener = modernListener
        ? { positionX: param(), positionY: param(), positionZ: param(), forwardX: param(), forwardY: param(), forwardZ: param(), upX: param(), upY: param(), upZ: param() }
        : { setPosition: (...a) => { this.listenerPos = a; }, setOrientation: (...a) => { this.listenerDir = a; } };
    }
    resume() { this.state = "running"; }
    createGain() { return node({ gain: param(1) }); }
    createOscillator() { return source({ type: "sine", frequency: param(440) }); }
    createBufferSource() { return source({ buffer: null, loop: false }); }
    createBiquadFilter() { return node({ type: "lowpass", frequency: param(), Q: param() }); }
    createDynamicsCompressor() { return node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }); }
    createBuffer(ch, len, sr) { const data = new Float32Array(len); return { getChannelData: () => data, duration: len / sr }; }
    createPanner() {
      const p = node(modernPanner ? { positionX: param(), positionY: param(), positionZ: param() } : { setPosition(...a) { this.pos = a; } });
      log.panners.push(p);
      return p;
    }
  }
  return { FakeAudioContext, log };
}

const allStopped = (log) => log.sources.every((s) => s.started >= 1 && s.stopped >= 1);

test("nothing happens (and nothing breaks) before the first click, or with no audio support", () => {
  const none = new Sfx(null);
  assert.equal(none.unlock(), false);
  const { FakeAudioContext } = makeFakeAudio();
  const sfx = new Sfx(FakeAudioContext);
  const beam = sfx.beamVoice(true);
  beam.start(); beam.stop(); sfx.death({ own: true }); sfx.preview(); sfx.silence();
  sfx.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  assert.equal(sfx.ready, false);
});

test("a laser gun starts once, runs while held, and every part of it stops on release", () => {
  const { FakeAudioContext, log } = makeFakeAudio();
  const sfx = new Sfx(FakeAudioContext);
  assert.equal(sfx.unlock(), true);
  assert.equal(sfx.ctx.state, "running");
  const beam = sfx.beamVoice(false);
  beam.start();
  beam.start();                       // called every frame while held: must not stack up
  const count = log.sources.length;
  assert.ok(count >= 3);
  assert.ok(log.sources.every((s) => s.started === 1));
  beam.stop();
  beam.stop();                        // and again when already off
  assert.ok(log.sources.every((s) => s.stopped === 1), "every oscillator and noise source stopped exactly once");
  beam.start();                       // it can be fired again
  assert.equal(log.sources.length, 2 * count);
});

test("other players' beams are placed in 3D and follow them; your own is not", () => {
  const { FakeAudioContext, log } = makeFakeAudio();
  const sfx = new Sfx(FakeAudioContext);
  sfx.unlock();
  const own = sfx.beamVoice(false);
  own.start();
  assert.equal(log.panners.length, 0);
  const theirs = sfx.beamVoice(true);
  theirs.setPosition(5, 1, -3);       // before it starts: remembered
  theirs.start();
  assert.equal(log.panners.length, 1);
  assert.equal(log.panners[0].positionX.value, 5);
  theirs.setPosition(9, 2, 4);        // while it runs: moves
  assert.equal(log.panners[0].positionX.value, 9);
  assert.equal(log.panners[0].positionZ.value, 4);
});

test("the hit sizzle runs only while it is on, and its tick stops itself", () => {
  const { FakeAudioContext, log } = makeFakeAudio();
  const sfx = new Sfx(FakeAudioContext);
  sfx.unlock();
  const hit = sfx.hitVoice();
  hit.start();
  assert.ok(log.sources.some((s) => s.started === 1));
  hit.stop();
  assert.ok(allStopped(log));
});

test("a death sound plays through and then stops all of its parts, near or far", () => {
  const { FakeAudioContext, log } = makeFakeAudio();
  const sfx = new Sfx(FakeAudioContext);
  sfx.unlock();
  const before = log.sources.length;
  sfx.death();
  sfx.death({ position: { x: 3, y: 1, z: 3 } });
  sfx.death({ position: undefined });
  const made = log.sources.slice(before);
  assert.equal(made.length, 18);       // six parts each: three tones, the wobble, the boom, the sparks
  assert.ok(made.every((s) => s.started >= 1 && s.stopped >= 1));
  assert.equal(log.panners.length, 1); // only the one with a position is placed in 3D
});

test("silence() stops every running beam and sizzle", () => {
  const { FakeAudioContext, log } = makeFakeAudio();
  const sfx = new Sfx(FakeAudioContext);
  sfx.unlock();
  const a = sfx.beamVoice(false), b = sfx.beamVoice(true), c = sfx.hitVoice();
  a.start(); b.start(); c.start();
  sfx.silence();
  assert.ok(allStopped(log));
  // and they can come back
  const n = log.sources.length;
  a.start();
  assert.ok(log.sources.length > n);
});

test("a disposed voice is forgotten", () => {
  const { FakeAudioContext } = makeFakeAudio();
  const sfx = new Sfx(FakeAudioContext);
  sfx.unlock();
  const v = sfx.beamVoice(true);
  v.start();
  v.dispose();
  assert.equal(sfx.voices.has(v), false);
});

test("volume is clamped, and it is squared so the slider feels even", () => {
  const { FakeAudioContext } = makeFakeAudio();
  const sfx = new Sfx(FakeAudioContext);
  sfx.setVolume(5);
  assert.equal(sfx.volume, 1);
  sfx.setVolume(-2);
  assert.equal(sfx.volume, 0);
  sfx.setVolume(0.5);
  sfx.unlock();
  assert.equal(sfx.master.gain.value, 0.25);
  sfx.setVolume(0.8);
  assert.ok(Math.abs(sfx.master.gain.target - 0.64) < 1e-9);
});

test("the 3D listener works on browsers with either audio API", () => {
  for (const modernListener of [true, false]) {
    const { FakeAudioContext } = makeFakeAudio({ modernListener, modernPanner: modernListener });
    const sfx = new Sfx(FakeAudioContext);
    sfx.unlock();
    sfx.setListener({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: -1 });
    if (modernListener) assert.equal(sfx.ctx.listener.positionZ.value, 3);
    else assert.deepEqual(sfx.ctx.listenerPos, [1, 2, 3]);
    const v = sfx.beamVoice(true);
    v.setPosition(4, 5, 6);
    v.start();
    v.stop();
  }
});

test("the sizzle is a real, loud-enough, finite loop with crackle in it", () => {
  const sr = 44100;
  const x = makeSizzleSamples(sr);
  assert.ok(x.length > sr * 2.3 && x.length < sr * 2.5);
  let sum = 0, peak = 0, bad = 0;
  for (const v of x) { if (!Number.isFinite(v)) bad++; sum += v * v; peak = Math.max(peak, Math.abs(v)); }
  const rms = Math.sqrt(sum / x.length);
  assert.equal(bad, 0);
  assert.ok(rms > 0.02 && rms < 0.4, `rms ${rms}`);
  assert.ok(peak > 0.1 && peak < 3, `peak ${peak}`);
  // crackly: it has sharp sudden changes, well above the average
  let jumps = 0, mean = 0;
  for (let i = 1; i < x.length; i++) mean += Math.abs(x[i] - x[i - 1]);
  mean /= x.length;
  for (let i = 1; i < x.length; i++) if (Math.abs(x[i] - x[i - 1]) > 6 * mean) jumps++;
  assert.ok(jumps > 100, `only ${jumps} sharp pops`);
  // it loops without a click: the end meets the start
  assert.ok(Math.abs(x[x.length - 1] - x[0]) < peak, "ends meet");
});

test("the sparks are finite and flicker", () => {
  const x = makeSparkSamples(44100);
  assert.ok(x.every((v) => Number.isFinite(v)));
  let loud = 0, quiet = 0;
  for (let i = 0; i < x.length; i += 441) { const a = Math.abs(x[i]); if (a > 0.2) loud++; else if (a < 0.01) quiet++; }
  assert.ok(loud > 3 && quiet > 20, `loud ${loud}, quiet ${quiet}`);
});
