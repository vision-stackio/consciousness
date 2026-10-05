// Headless tests for conversation, memory, commands, exploration and natural speech in the local mind.
const store = () => ({ d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; }, removeItem(k) { delete this.d[k]; } });
const { Brain } = await import("../client/js/brain.js");
let fails = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${n} ${x}`); if (!ok) fails++; };

function make(opts = {}) {
  globalThis.localStorage = store();
  let clock = 1e6; const pose = { x: 0, z: 0, unit: 1, headingDeg: 0 }; const said = [];
  const world = [{ id: "toy_red", kind: "toy", x: 14, z: 2, color: "#f00" }, { id: "toy_blue", kind: "toy", x: -10, z: 18, color: "#00f" }];
  const body = {
    async act(instr, say) {
      let ms = 0, walking = false;
      for (const i of instr) {
        if (i.op === "SLEEP") ms += i.ms; else if (i.command === "FACE") pose.headingDeg = Number(i.arg);
        else if (i.command === "TURN_LEFT") { pose.headingDeg -= 90; ms += 600; } else if (i.command === "TURN_RIGHT") { pose.headingDeg += 90; ms += 600; }
        else if (i.command === "WALK_FORWARD") walking = true;
        else if (i.command === "GOTO") { const [x, z] = String(i.arg).split(",").map(Number); ms += (Math.hypot(x - pose.x, z - pose.z) / 2.7) * 1000; pose.x = x; pose.z = z; }
      }
      if (walking) { const y = (pose.headingDeg * Math.PI) / 180, d = (ms / 1000) * 2.7; pose.x += Math.sin(y) * d; pose.z += Math.cos(y) * d; }
      clock += ms; if (say) said.push(say);
    }, isBusy: () => false, getPose: () => ({ ...pose }), getWorld: () => world,
  };
  const brain = new Brain(body, { now: () => clock, ...opts });
  const step = async (secs) => { for (let i = 0; i < secs; i++) { clock += 1000; brain.tick(); await new Promise((r) => setImmediate(r)); } };
  return { brain, step, said, pose, tick: (ms) => (clock += ms) };
}

// ---- conversation + memory
{
  const { brain } = make(); brain.setMode("local");
  let r = brain.hear("my favorite color is blue");
  check("learns a fact and says so", /favorite color/.test(r.reply) && brain.memory.long.facts["favorite color"] === "blue", `("${r.reply}")`);
  r = brain.hear("what's my favorite color"); check("recalls it later", /blue/.test(r.reply), `("${r.reply}")`);
  brain.hear("my name is ravi"); r = brain.hear("do you remember my name");
  check("remembers the name", /Ravi/.test(r.reply), `("${r.reply}")`);
  r = brain.hear("could you stop"); check("always obeys stop", r.instructions.some((i) => i.command === "WALK_STOP"));

  brain["valence"] = -1; brain["boredom"] = 0; brain["curiosity"] = 0;
  r = brain.hear("please dance"); check("refuses when in a bad mood, with a reason", r.instructions.length === 0 && r.reply.length > 8, `("${r.reply}")`);
  brain["valence"] = 0.8; brain["boredom"] = 1; brain.memory.long.interactions = 30;
  r = brain.hear("can you dance for me?"); check("agrees when happy and bored", r.instructions.some((i) => i.command === "DANCE"), `("${r.reply}")`);
  brain["lastAction"] = "wander"; r = brain.hear("why did you do that"); check("explains his last action", /somewhere new/.test(r.reply), `("${r.reply}")`);
}

// ---- AI mode: the cortex gets facts, personality and the conversation
{
  let seen = null;
  const { brain } = make({ think: async (req) => { seen = req; return { thought: "ok", action: { type: "idle" }, say: "Hi!", next_think_in_s: 5 }; } });
  brain.setMode("ai"); brain.hear("my favorite food is pizza"); brain.hear("hello vision");
  await new Promise((r) => setTimeout(r, 30));
  check("AI request includes remembered facts", seen?.memory.facts["favorite food"] === "pizza");
  check("AI request includes the conversation", seen?.conversation.some((c) => c.who === "user" && /hello/.test(c.text)));
  check("AI request includes personality traits", typeof seen?.memory.traits.shy === "number");
}

// ---- exploration: smart vs random (10 runs each, 30 simulated minutes; single runs are too noisy to compare)
async function explore(smart) {
  const xs = [];
  for (let k = 0; k < 10; k++) { const { brain, step } = make({ smartExplore: smart }); brain.setMode("local"); await step(1800); xs.push(brain.memory.long.cells.length); }
  return xs.reduce((a, c) => a + c, 0) / xs.length;
}
const smart = await explore(true), random = await explore(false);
check("explores more new places on purpose than at random", smart > random * 1.08, `(smart ${smart.toFixed(1)} vs random ${random.toFixed(1)} places in 30 min, ${(100 * (smart / random - 1)).toFixed(0)}% more)`);

// ---- natural speech: no back-to-back repeats, and he sometimes recalls his own past
{
  const { brain, step, said } = make(); brain.setMode("local"); await step(2400);
  let dup = 0; for (let i = 1; i < said.length; i++) if (said[i] === said[i - 1]) dup++;
  check("never says the same line twice in a row", dup === 0, `(${said.length} lines, ${dup} repeats)`);
  const recalls = said.filter((s) => /earlier|keep thinking|remember|still remember/.test(s));
  check("sometimes talks about his own past", recalls.length > 0, `(${recalls.length}, e.g. "${recalls[0]}")`);
  const distinct = new Set(said).size; check("speech has variety", distinct >= 8, `(${distinct} distinct lines)`);
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
