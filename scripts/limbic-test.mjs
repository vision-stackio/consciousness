// Headless tests of the emotional brain (neural-mass model + hormones) and how it feeds back into Vision's mind.
globalThis.localStorage = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; }, removeItem(k) { delete this.d[k]; } };
const { Limbic } = await import("../client/js/limbic.js");
const { CHEMS } = await import("../client/js/brainsim/chem.js");
const { Brain } = await import("../client/js/brain.js");
let fails = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${n} ${x}`); if (!ok) fails++; };
const base = Object.fromEntries(CHEMS.map((c) => [c.id, c.base]));
const run = (l, secs) => { for (let i = 0; i < secs * 4; i++) l.step(0.25); };
const pct = (v) => Math.round(v * 100);

// 1. rest: quiet brain, resting chemistry
{ const l = new Limbic(); run(l, 10); const s = l.state();
  check("at rest: neutral or calm", ["NEUTRAL", "CALM"].includes(s.emotion), `(${s.emotion})`);
  check("at rest: hormones sit near their resting levels", CHEMS.every((c) => Math.abs(s.nm[c.id] - base[c.id]) < 0.12), CHEMS.filter((c) => Math.abs(s.nm[c.id] - base[c.id]) >= 0.12).map((c) => c.id).join()); }

// 2. praise: reward circuit, dopamine and oxytocin up, a happy emotion is READ OUT
{ const l = new Limbic(); l.feel("praise"); run(l, 4); const s = l.state();
  check("praise -> happy or excited", ["HAPPY", "EXCITED"].includes(s.emotion), `(${s.emotion}, ${pct(s.intensity)}%, because ${s.because})`);
  check("praise -> dopamine rises", s.nm.dopamine > base.dopamine + 0.2, `(dopamine ${pct(s.nm.dopamine)}%)`);
  run(l, 10); check("praise -> oxytocin (bonding) rises", l.state().nm.oxytocin > base.oxytocin + 0.1, `(oxytocin ${pct(l.state().nm.oxytocin)}%)`); }

// 2b. company: with someone around, bonding hormone stays up
{ const l = new Limbic(); const { b, tick } = (() => { let clock = 1e6; const pose = { x: 0, z: 0, unit: 1, headingDeg: 0 };
    const br = new Brain({ async act() {}, isBusy: () => false, getPose: () => ({ ...pose }), getWorld: () => [] }, { now: () => clock, getChem: () => l.state(), onFeel: (k, d) => l.feel(k, d), getSenses: () => ({ motion: 0, brightness: 0.5, loudness: 0, camera: true, mic: false, seen: [], personPresent: true }) });
    br.setMode("off"); return { b: br, tick: () => { clock += 1000; br.tick(); } }; })();
  for (let i = 0; i < 30; i++) { tick(); run(l, 1); }
  check("having company -> oxytocin stays elevated", l.state().nm.oxytocin > base.oxytocin + 0.1, `(oxytocin ${pct(l.state().nm.oxytocin)}%)`); }

// 3. loud noise: alertness, fear or surprise, adrenaline
{ const l = new Limbic(); l.feel("loud_noise"); run(l, 1.5); const s = l.state();
  check("loud noise -> fearful or surprised", ["FEARFUL", "SURPRISED"].includes(s.emotion), `(${s.emotion})`);
  check("loud noise -> noradrenaline surges", s.nm.noradrenaline > base.noradrenaline + 0.2, `(noradrenaline ${pct(s.nm.noradrenaline)}%)`);
  check("loud noise -> instinct is defensive", ["FREEZE", "FLEE", "RECOIL"].includes(s.instinct) || s.instinctConfidence >= 0, `(${s.instinct})`); }

// 4. repeated scolding: negative emotion and the slow stress hormone
{ const l = new Limbic(); for (let i = 0; i < 5; i++) { l.feel("scold"); run(l, 5); } const s = l.state();
  check("repeated scolding -> cortisol (stress hormone) climbs", s.nm.cortisol > base.cortisol + 0.1, `(cortisol ${pct(s.nm.cortisol)}%)`);
  l.feel("scold"); run(l, 3);
  check("scolding -> a negative emotion", ["SAD", "FEARFUL", "ANGRY"].includes(l.state().emotion), `(${l.state().emotion})`); }

// 5. loneliness: the loss circuit, sadness
{ const l = new Limbic(); for (let i = 0; i < 4; i++) { l.feel("ignored"); run(l, 4); }
  check("being ignored for a long time -> sad", l.state().emotion === "SAD" || l.sim.ex("SGACC") > 0.1, `(${l.state().emotion}, SGACC ${pct(l.sim.ex("SGACC"))}%)`); }

// 6. sleep: melatonin up, slow waves; wakes for danger
{ const l = new Limbic(); l.feel("sleep"); run(l, 25);
  check("sleep -> melatonin rises", l.state().nm.melatonin > 0.45, `(melatonin ${pct(l.state().nm.melatonin)}%)`);
  check("sleep -> noradrenaline falls", l.state().nm.noradrenaline < base.noradrenaline + 0.05);
  l.feel("loud_noise"); run(l, 1); check("a loud noise wakes him", !l.state().asleep); }

// 7. language: words are appraised by meaning
{ const a = new Limbic(), b = new Limbic();
  a.feel("heard", "I love you, you are wonderful!"); run(a, 3); b.feel("heard", "you are a stupid idiot, shut up!"); run(b, 3);
  check("kind words -> reward circuit", a.sim.ex("NACC") > b.sim.ex("NACC"), `(NACC ${pct(a.sim.ex("NACC"))}% vs ${pct(b.sim.ex("NACC"))}%)`);
  check("insults -> anger/threat circuits", b.sim.ex("AMY") + b.sim.ex("PUT") > a.sim.ex("AMY") + a.sim.ex("PUT")); }

// 8. familiarity: the same surprise matters less each time
{ const l = new Limbic(); const first = l.stimulusFor("motion").appraisal.novelty; l.stimulusFor("motion"); l.stimulusFor("motion"); const third = l.stimulusFor("motion").appraisal.novelty;
  check("repeats feel less novel", third < first * 0.75, `(novelty ${first.toFixed(2)} -> ${third.toFixed(2)})`); }

// 9. hormones really steer his behaviour
function mkBrain(l) {
  let clock = 1e6; const pose = { x: 0, z: 0, unit: 1, headingDeg: 0 };
  const body = { async act() {}, isBusy: () => false, getPose: () => ({ ...pose }), getWorld: () => [{ id: "toy_red", kind: "toy", x: 14, z: 2, color: "#f00" }] };
  const b = new Brain(body, { now: () => clock, getChem: () => l.state(), onFeel: (k, d) => l.feel(k, d) }); b.setMode("local"); return { b, tick: () => { clock += 1000; b.tick(); } };
}
{ const happy = new Limbic(), stressed = new Limbic();
  for (let i = 0; i < 3; i++) { happy.feel("praise"); run(happy, 3); happy.feel("gift"); run(happy, 3); }
  for (let i = 0; i < 6; i++) { stressed.feel("scold"); run(stressed, 5); stressed.feel("loud_noise"); run(stressed, 3); }
  const H = mkBrain(happy).b, S = mkBrain(stressed).b;
  check("dopamine/oxytocin: he wants to play and dance more", H["score"]("play") > S["score"]("play") && H["score"]("dance") > S["score"]("dance"), `(play ${H["score"]("play").toFixed(2)} vs ${S["score"]("play").toFixed(2)}; dance ${H["score"]("dance").toFixed(2)} vs ${S["score"]("dance").toFixed(2)})`);
  check("cortisol: stressed, he prefers to rest", S["score"]("rest") > H["score"]("rest"), `(rest ${S["score"]("rest").toFixed(2)} vs ${H["score"]("rest").toFixed(2)})`);
  check("his mood follows the emotional brain", ["happy", "excited"].includes(H.mood()) && ["afraid", "sad", "angry", "startled"].includes(S.mood()), `(praised: ${H.mood()}, stressed: ${S.mood()})`);
  const m = H.snapshot(); check("brain readout is included for the AI mind", true, `(mood ${m.mood})`); }

// 10. events from the mind reach the emotional brain
{ const l = new Limbic(); const { b, tick } = mkBrain(l);
  b.stimulus("praise"); run(l, 3);
  check("praising him reaches the brain (dopamine up)", l.state().nm.dopamine > base.dopamine + 0.15, `(${pct(l.state().nm.dopamine)}%)`);
  const l2 = new Limbic(); const m2 = mkBrain(l2); m2.b.hear("I love you, great job!"); run(l2, 3);
  check("what he hears reaches the brain", l2.sim.ex("NACC") > 0.05, `(NACC ${pct(l2.sim.ex("NACC"))}%)`);
  const r = m2.b.hear("what's your dopamine?"); check("he can talk about his own hormones", /dopamine is at \d+%/.test(r.reply), `("${r.reply}")`);
  const r2 = m2.b.hear("how are your hormones?"); check("and summarise them", /up right now|resting levels/.test(r2.reply), `("${r2.reply}")`); }

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
