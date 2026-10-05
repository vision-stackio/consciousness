// Headless life simulation: runs Vision's brain for N simulated minutes with a fake body.
// Usage: npm run sim [-- minutes] [--ai]     (--ai uses a scripted stand-in for the LLM cortex)
const minutes = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 30);
const useAI = process.argv.includes("--ai");

globalThis.localStorage = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; }, removeItem(k) { delete this.d[k]; } };
const { Brain } = await import("../client/js/brain.js");

let clock = 0;
const pose = { x: 0, z: 0, unit: 1, headingDeg: 0 };
const world = [
  { id: "toy_blue", kind: "toy", x: -10, z: 18, color: "#38bdf8" },
  { id: "toy_red", kind: "toy", x: 14, z: 2, color: "#ef4444" },
];
const speech = [], counts = {};
const body = {
  async act(instr, say) {
    let ms = 0, walking = false;
    for (const i of instr) {
      if (i.op === "SLEEP") ms += i.ms;
      else if (i.command === "TURN_LEFT") { pose.headingDeg -= 90; ms += 600; }
      else if (i.command === "TURN_RIGHT") { pose.headingDeg += 90; ms += 600; }
      else if (i.command === "FACE") pose.headingDeg = Number(i.arg);
      else if (i.command === "WALK_FORWARD") walking = true;
      else if (i.command === "GOTO") { const [x, z] = String(i.arg).split(",").map(Number); ms += (Math.hypot(x - pose.x, z - pose.z) / 2.7) * 1000; pose.x = x; pose.z = z; }
    }
    if (walking) { const y = (pose.headingDeg * Math.PI) / 180, d = (ms / 1000) * 2.7; pose.x += Math.sin(y) * d; pose.z += Math.cos(y) * d; }
    clock += ms; if (say) speech.push(say);
  },
  isBusy: () => false, getPose: () => ({ ...pose }), getWorld: () => world,
};

// Scripted stand-in for the LLM: picks something sensible from the situation it is given.
const think = async (req) => {
  const s = req.state;
  if (s.curiosity > 0.5) return { thought: "Curious. The red toy looks fun.", action: { type: "go_to", target: "toy_red" }, say: "Let's play!", next_think_in_s: 5 };
  if (Math.random() < 0.1) return { thought: "Trying a bad target on purpose.", action: { type: "go_to", target: "nonexistent" }, next_think_in_s: 4 };
  return { thought: "Looking around.", action: { type: "look", angle: 40 }, next_think_in_s: 5 };
};

const brain = new Brain(body, {
  now: () => clock, think: useAI ? think : undefined,
  onEvent: (t, text) => { if (t === "system" && /unknown target|unavailable/.test(text)) counts["(rejected by safety)"] = (counts["(rejected by safety)"] ?? 0) + 1; },
});
brain.setMode(useAI ? "ai" : "local");

const moods = {}; let maxDist = 0, lastThought = "";
for (let s = 0; s < minutes * 60; s++) {
  clock += 1000; brain.tick(); await new Promise((r) => setImmediate(r));
  const m = brain.snapshot();
  if (m.thought !== lastThought) { lastThought = m.thought; counts[m.lastAction] = (counts[m.lastAction] ?? 0) + 1; }
  moods[m.mood] = (moods[m.mood] ?? 0) + 1; maxDist = Math.max(maxDist, Math.hypot(pose.x, pose.z));
}
console.log(`\n${minutes} simulated minutes, ${useAI ? "AI (scripted cortex)" : "local"} mind`);
console.log("actions:", counts);
console.log("mood seconds:", moods);
console.log("farthest from home:", maxDist.toFixed(1), "(arena radius 40)");
console.log("learned action values:", Object.fromEntries(Object.entries(brain.memory.long.actionValue).map(([k, v]) => [k, +v.toFixed(2)])));
console.log("places discovered:", brain.memory.long.cells.length, "| favorite:", brain.memory.long.favorite ?? "none yet");
console.log("sample speech:", speech.slice(0, 4));
