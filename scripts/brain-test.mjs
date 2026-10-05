// Headless tests of the local mind's reactions to sight, habituation, learning and personality.
globalThis.localStorage = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; }, removeItem(k) { delete this.d[k]; } };
const { Brain } = await import("../client/js/brain.js");
let clock = 1e6, fails = 0;
const check = (n, ok, x = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${n} ${x}`); if (!ok) fails++; };
const pose = { x: 0, z: 0, unit: 1, headingDeg: 0 };
const said = [], acted = {};
const world = [{ id: "toy_red", kind: "toy", x: 14, z: 2, color: "#f00" }];
const body = { async act(instr, say) { let ms = 0; for (const i of instr) if (i.op === "SLEEP") ms += i.ms; clock += ms; if (say) said.push(say); }, isBusy: () => false, getPose: () => ({ ...pose }), getWorld: () => world };
let senses = { motion: 0, brightness: 0.5, loudness: 0, camera: true, mic: false, seen: [], personPresent: false, visionMode: "model" };
const brain = new Brain(body, { now: () => clock, getSenses: () => senses, onEvent: (t, text) => { if (t === "action") { const k = text.split(" ")[0]; acted[k] = (acted[k] ?? 0) + 1; } } });
brain.setMode("local");
const step = async (secs) => { for (let i = 0; i < secs; i++) { clock += 1000; brain.tick(); await new Promise((r) => setImmediate(r)); } };

// 1. a person appears on the left: greeting, attentive mood, social need drops
await step(5); const social0 = brain.snapshot().social;
senses = { ...senses, seen: [{ label: "person", side: "left", near: true }], personPresent: true };
brain.sight({ type: "appeared", label: "person", side: "left", near: true });
await new Promise((r) => setImmediate(r));
check("greets a person who just appeared", said.length > 0 && said.at(-1) !== "All quiet.", `("${said.at(-1)}")`);
check("social need drops when someone shows up", brain.snapshot().social < social0 - 0.3);
check("mood lifts when someone shows up (attentive or excited)", ["attentive", "excited"].includes(brain.snapshot().mood), `(mood ${brain.snapshot().mood})`);

// 2. while the person is there, he mostly pays attention instead of wandering off
Object.keys(acted).forEach((k) => delete acted[k]);
await step(120);
check("pays attention to the person (watch)", (acted.watch ?? 0) >= 5, JSON.stringify(acted));
check("wanders much less than he watches", (acted.Restless ?? 0) < (acted.watch ?? 0));

// 3. a labelled object: comments once, not every time
said.length = 0; clock += 12000;
brain.sight({ type: "appeared", label: "cup", side: "right", near: false }); await new Promise((r) => setImmediate(r));
const first = said.length; clock += 7000;
brain.sight({ type: "left", label: "cup", side: "right", near: false }); brain.sight({ type: "appeared", label: "cup", side: "right", near: false }); await new Promise((r) => setImmediate(r));
check("names a new object once, then stays quiet (cooldown)", first === 1 && said.length === 1, `(said: ${JSON.stringify(said)})`);

// 4. leaving: social need rises again
const s1 = brain.snapshot().social; senses = { ...senses, seen: [], personPresent: false };
brain.sight({ type: "left", label: "person", side: "left", near: false, durationMs: 40000 });
check("misses the person after they leave", brain.snapshot().social > s1);

// 5. habituation: the 5th sudden movement matters far less than the 1st
const gain = () => { const a0 = brain.snapshot().arousal; brain.stimulus("motion"); return brain.snapshot().arousal - a0; };
await step(60); const g1 = gain(); await step(1); gain(); gain(); gain(); const g5 = gain();
check("gets used to repeated movement (habituation)", g5 < g1 * 0.6, `(1st +${g1.toFixed(2)}, 5th +${g5.toFixed(2)})`);

// 6. personality drifts with experience
const t0 = { ...brain.memory.long.traits };
for (let i = 0; i < 5; i++) brain.stimulus("scold");
check("scolding makes him shyer", brain.memory.long.traits.shy > t0.shy + 0.1, `(shy ${t0.shy.toFixed(2)} -> ${brain.memory.long.traits.shy.toFixed(2)})`);

// 7. situation-specific learning is being recorded
await step(600);
const ctx = Object.keys(brain.memory.long.ctxValue);
check("learns per situation (mood|company|action)", ctx.length >= 5, `(${ctx.length} entries, e.g. ${ctx[0]})`);

// 8. something held up to the camera gets an excited, specific reaction (and bypasses the chatter cooldown)
brain.setMode("off"); await new Promise((r) => setTimeout(r, 20)); clock += 20000; said.length = 0; // freeze autonomy so only the reaction is measured
brain["curiosity"] = 0.8; const cur0 = brain.snapshot().curiosity;
brain.sight({ type: "appeared", label: "cup", side: "center", near: true, size: 0.2, cx: 0.5, color: "red", source: "camera", score: 0.9 }); await new Promise((r) => setImmediate(r));
check("reacts to an object shown to the camera", said.length === 1 && /Ooh/.test(said[0]), `("${said[0]}")`);
check("showing something satisfies curiosity", brain.snapshot().curiosity < cur0 - 0.1);
brain.sight({ type: "appeared", label: "book", side: "center", near: true, size: 0.2, cx: 0.5, color: "blue", source: "camera", score: 0.9 }); await new Promise((r) => setImmediate(r));
check("a second object shown right after still gets a reaction", said.length === 2, `(said: ${JSON.stringify(said)})`);
// 9. a small object far to the side is just noticed, not treated as "being shown"
said.length = 0; clock += 100000;
brain.sight({ type: "appeared", label: "bottle", side: "right", near: false, size: 0.02, cx: 0.9, source: "camera", score: 0.8 }); await new Promise((r) => setImmediate(r));
check("small off-centre object is not mistaken for being shown", said.length === 0 || !/Ooh/.test(said[0]), `(${JSON.stringify(said)})`);
// 10. objects in the arena
said.length = 0; clock += 100000; let heard = 0;
for (let i = 0; i < 12; i++) { brain.sight({ type: "appeared", label: "red toy", side: "left", near: false, source: "arena" }); clock += 61000; }
await new Promise((r) => setImmediate(r));
check("notices arena objects out loud, but not every single time", said.some((x) => /red toy/.test(x)) && said.length < 12, `(${said.length} comments in 12 sightings)`);
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
