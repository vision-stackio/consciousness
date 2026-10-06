/**
 * Sandbox entry point: wires the 3D body, the senses, the voice, the brain and the UI.
 * Everything Vision does goes through executeInstructions(), the single motor gate.
 */
import { Brain, ARENA, ARENA_INFINITE, type Instr, type Mode, type MindSnapshot, type Stimulus, type WorldObject, type EventType } from "./brain.js";
import { Senses } from "./senses.js";
import { askCortex, fetchHealth } from "./cortexClient.js";
import { Steering, resolveOverlap, type Obstacle } from "./steering.js";
import { SightTracker, worldDetections, arenaLabel, type Sight } from "./vision.js";
import { Limbic } from "./limbic.js";
import { BrainRenderer } from "./brainview.js";
import { BrainPanel } from "./brainpanel.js";
import { buildCloud, buildFibres } from "./brainsim/geometry.js";

const banner = document.getElementById("protoBanner")!;
if (location.protocol === "file:") { banner.classList.add("show"); throw new Error("Serve the page with `npm start`."); }
if (!(window as any).THREE) { document.getElementById("modelLoading")!.textContent = "Couldn't load three.js from cdnjs.cloudflare.com."; throw new Error("THREE missing"); }

const { Rig } = await import("./rig.js");
const { createSpeechController } = await import("./speech.js");
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// If his eyes look the wrong way for you, set GAZE_FLIP to true.
const GAZE_FLIP = false;
const eyeDir = () => (GAZE_FLIP ? -1 : 1);
let stopped = false;               // true while E-STOP is engaged
let lastUserSpeechAt = -1e9;       // he looks at you for a few seconds after you speak
// Base voice presets by mood word (rate, pitch). These are refined live by hormones.
const VOICE: Record<string, [number, number]> = {
  excited: [1.12, 1.2], curious: [1.05, 1.12], attentive: [1.0, 1.08], content: [1.0, 1.05], calm: [0.96, 1.0],
  bored: [0.9, 0.95], lonely: [0.92, 0.98], startled: [1.2, 1.25],
  happy: [1.06, 1.15], afraid: [1.18, 1.22], angry: [1.08, 0.85], sad: [0.86, 0.88], disgusted: [0.95, 0.9], hurt: [0.92, 1.1], sleepy: [0.8, 0.85],
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Compute natural prosody from the emotional brain.
 * Rate / pitch / volume are shaped by current emotion + key neuromodulators
 * so the voice feels like it comes from the same organism as the decisions.
 */
function voiceFromBrain(mood: string): { rate: number; pitch: number; volume: number } {
  const [baseRate, basePitch] = VOICE[mood] ?? [1.02, 1.05];
  const st = limbic.state();
  const nm = st.nm;
  // Arousal-like modulators speed speech up; calming ones slow it down
  const arousal = (nm.noradrenaline - 0.1) * 0.35 + (nm.adrenaline - 0.05) * 0.4 + (nm.dopamine - 0.1) * 0.2;
  const calm = (nm.serotonin - 0.4) * 0.25 + (nm.gaba - 0.3) * 0.15 + (nm.melatonin - 0.1) * 0.5;
  const stress = (nm.cortisol - 0.1) * 0.3;
  // Pitch rises with positive affect and arousal, drops with sadness / high cortisol
  const affect = st.emotion === "HAPPY" || st.emotion === "EXCITED" || st.emotion === "CURIOUS" ? 0.12
    : st.emotion === "SAD" || st.emotion === "PAIN" ? -0.12
    : st.emotion === "ANGRY" ? -0.08
    : st.emotion === "FEARFUL" || st.emotion === "SURPRISED" ? 0.1 : 0;

  const rate = clamp(baseRate + arousal * 0.35 - calm * 0.4 + stress * 0.15, 0.72, 1.45);
  const pitch = clamp(basePitch + affect + arousal * 0.18 - calm * 0.12 - stress * 0.1, 0.7, 1.55);
  // Slightly quieter when sleepy or very stressed, brighter when excited
  const volume = clamp(0.92 + (nm.dopamine - 0.1) * 0.25 - (nm.melatonin - 0.1) * 0.35 - Math.max(0, nm.cortisol - 0.25) * 0.2, 0.55, 1);
  return { rate, pitch, volume };
}

// ---------------------------------------------------------------- world ----
const world: WorldObject[] = [];       // what Vision knows about (toys, landmarks)
const obstacles: Obstacle[] = [];      // everything solid (he walks around these, known or not)
const steering = new Steering();
let unit = 1;
let wandering = false, wanderHeading = 0, navActive = 0;
const bodyR = () => unit * 0.7;        // robot body radius for collision purposes
const steerOpts = (ignore?: string) => ({ body: bodyR(), lookahead: 7 * unit, margin: 0.5 * unit, ignore });

/**
 * Add a 3D model to the sandbox.
 *  solid: Vision walks around it.   known: Vision (and the AI) can see it and walk to it.
 * size is in robot-sizes. Example (inside placeProps):
 *   await addScenery({ id: "tree1", url: "/assets/models/tree.glb", x: 20 * unit, z: -8 * unit, size: 4, known: true });
 */
async function addScenery(o: { id: string; url: string; x: number; z: number; size?: number; rotY?: number; solid?: boolean; known?: boolean }) {
  const { radius } = await Rig.addModel(o);
  if (o.solid !== false) obstacles.push({ id: o.id, x: o.x, z: o.z, r: radius * 0.8 });
  if (o.known) world.push({ id: o.id, kind: "landmark", x: o.x, z: o.z, color: "#ffffff", r: radius * 0.8 });
}
(window as any).vision = { addScenery, world, obstacles }; // handy from the browser console
function placeProps() {
  unit = Rig.getPosition().unit;
  if (!ARENA_INFINITE) Rig.addProp({ id: "arena", kind: "ring", x: 0, z: 0, color: 0xa78bfa, radius: ARENA * unit });
  const add = (o: WorldObject) => { world.push(o); Rig.addProp({ id: o.id, kind: o.kind, x: o.x, z: o.z, color: parseInt(o.color.slice(1), 16), radius: unit }); obstacles.push({ id: o.id, x: o.x, z: o.z, r: unit * 0.35 }); };
  add({ id: "toy_red", kind: "toy", x: 14 * unit, z: 2 * unit, color: "#ef4444" });
  add({ id: "toy_blue", kind: "toy", x: -10 * unit, z: 18 * unit, color: "#38bdf8" });
  add({ id: "toy_green", kind: "toy", x: -16 * unit, z: -12 * unit, color: "#84cc16" });
}

// ------------------------------------------------------------- UI helpers --
let captionTimer: number | undefined;
function showCaption(role: "user" | "assistant", text: string) {
  const el = $("caption");
  clearTimeout(captionTimer);
  el.className = `caption show ${role}`;
  el.replaceChildren();
  const who = document.createElement("span"); who.className = "who"; who.textContent = role === "user" ? "You" : "Vision";
  el.append(who, document.createTextNode(text)); // textContent only: LLM output is never injected as HTML
  captionTimer = window.setTimeout(() => el.classList.remove("show"), role === "user" ? 2800 : 6000);
}
function addLog(type: EventType, text: string) {
  const log = $("log");
  const row = document.createElement("div"); row.className = type;
  const t = document.createElement("time"); t.textContent = new Date().toLocaleTimeString([], { hour12: false });
  row.append(t, document.createTextNode(text));
  log.prepend(row);
  while (log.childElementCount > 1 && (log.scrollHeight > log.clientHeight + 1 || log.childElementCount > 150)) log.lastElementChild!.remove(); // no scrollbar: the oldest entries fall off
}

// ---------------------------------------------------------- motor / voice --
let eyeLock = 0;          // >0 while a scripted action is moving his eyes, so gaze tracking stays out of the way
let motionToken = 0;      // bumping this cancels every in-flight GOTO / sequence loop
let busyCount = 0;
let voiceOn = true;
let speaking = false;
const speech = createSpeechController({
  onInterim: () => { brain.notice(); lastUserSpeechAt = performance.now(); },
  onFinal: (text: string) => { if (!speaking) handleUserText(text); },
  onListeningChange: (on: boolean) => { $("micBtn").classList.toggle("live", on); },
});

function speak(text: string) {
  if (!text || !voiceOn) return;
  speaking = true; senses.muted = true;
  const prosody = voiceFromBrain(brain.mood());
  speech.speak(text, {
    rate: prosody.rate,
    pitch: prosody.pitch,
    volume: prosody.volume,
    onEnd: () => setTimeout(() => { speaking = false; senses.muted = false; }, 450),
  });
}

const angleDiff = (a: number, b: number) => (((a - b) % 360) + 540) % 360 - 180;

async function goTo(x: number, z: number, stop: number, token: number) {
  const t0 = performance.now();
  Rig.setDancing(false); wandering = false; navActive++; steering.forget(); eyeLock++; // eyes lead the body while travelling
  const goal = obstacles.find((o) => Math.hypot(o.x - x, o.z - z) < unit)?.id; // never avoid the thing we're walking to
  try {
    while (token === motionToken && performance.now() - t0 < 25000) {
      const p = Rig.getPosition();
      const dx = x - p.x, dz = z - p.z;
      if (Math.hypot(dx, dz) <= stop) break;
      const desired = (Math.atan2(dx, dz) * 180) / Math.PI;
      const heading = steering.heading(p, desired, obstacles, steerOpts(goal)); // sidestep anything in the way
      Rig.setBodyTurn(heading);
      const rel = angleDiff(heading, Rig.getTurnDeg());
      Rig.setEyeAngle(clamp(90 + eyeDir() * rel * 0.7, 35, 145));            // look where he is going before the body gets there
      Rig.setWalking(Math.abs(rel) < 28, 1);                                     // turn first, then walk
      await delay(60);
    }
  } finally { navActive--; eyeLock--; Rig.setWalking(false); Rig.setEyeAngle(90); }
}

async function executeInstructions(instructions: Instr[]) {
  if (!instructions.length) return;
  const token = motionToken;
  const usesEyes = instructions.some((i) => i.op === "EXEC" && i.command.startsWith("EYE_"));
  if (usesEyes) eyeLock++;
  busyCount++; $("bodyState").textContent = "Acting…";
  try {
    for (const i of instructions) {
      if (token !== motionToken) break;
      if (i.op === "SLEEP") { await delay(i.ms); continue; }
      const arg = i.arg;
      switch (i.command) {
        case "EYE_CENTER": Rig.setEyeAngle(90); break;
        case "EYE_SET": Rig.setEyeAngle(clamp(Number(arg), 0, 180)); break;
        case "EYE_LEFT": Rig.setEyeAngle(clamp(Rig.getEyeAngle() - Number(arg ?? 15), 0, 180)); break;
        case "EYE_RIGHT": Rig.setEyeAngle(clamp(Rig.getEyeAngle() + Number(arg ?? 15), 0, 180)); break;
        case "TURN_LEFT": Rig.setBodyTurn(Rig.getBodyTurn() - 90); await delay(Number(arg ?? 600)); break;
        case "TURN_RIGHT": Rig.setBodyTurn(Rig.getBodyTurn() + 90); await delay(Number(arg ?? 600)); break;
        case "FACE": Rig.setBodyTurn(Number(arg)); break;
        case "WALK_FORWARD": Rig.setDancing(false); wandering = true; wanderHeading = Rig.getBodyTurn(); steering.forget(); Rig.setWalking(true, 1); $("bodyState").textContent = "Walking"; break;
        case "WALK_STOP": wandering = false; Rig.setWalking(false); Rig.setDancing(false); $("bodyState").textContent = "Idle"; break;
        case "DANCE": Rig.setWalking(false); Rig.setDancing(true); $("bodyState").textContent = "Dancing"; break;
        case "GOTO": {
          const [x, z, stop] = String(arg).split(",").map(Number);
          if ([x, z, stop].every(Number.isFinite)) { $("bodyState").textContent = "Going somewhere"; await goTo(x, z, stop, token); }
          break;
        }
        default: break;
      }
    }
  } finally {
    if (usesEyes) eyeLock--;
    busyCount--;
    if (busyCount === 0 && !Rig.isWalking()) $("bodyState").textContent = $("bodyState").textContent === "Dancing" ? "Dancing" : "Idle";
  }
}

// -------------------------------------------------------------- the brain --
const senses = new Senses($<HTMLVideoElement>("cam"));
let shareFrames = false;

// ---- the emotional brain: a rotating 3D brain with hormones, driven by what happens to him ----
const limbic = new Limbic();
const density = Math.max(0.3, Math.min(1.5, Number(new URLSearchParams(location.search).get("density")) || 0.8)); // ?density=0.5 on a slow machine
const cloud = buildCloud(limbic.sim.nodes, density);
const fibres = buildFibres(cloud, limbic.sim.nodes, Math.round(340 * Math.min(1, density)));
const brainRenderer = new BrainRenderer(limbic.sim, cloud, fibres, { left: $<HTMLCanvasElement>("brainCanvas") });
const brainPanel = new BrainPanel(limbic, brainRenderer);
let limbicScale = 1;                 // follows the "time speed" control
let lastFrame = performance.now(), panelTimer = 0;
function brainFrame(now: number) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  for (let left = dt * limbicScale, i = 0; left > 1e-6 && i < 8; i++) { const h = Math.min(0.25, left); limbic.step(h); left -= h; }
  brainRenderer.draw(dt, limbic.sim.time);
  panelTimer += dt; if (panelTimer > 0.12) { panelTimer = 0; brainPanel.update(); }
  requestAnimationFrame(brainFrame);
}
requestAnimationFrame(brainFrame);
(window as any).limbic = limbic;     // poke it from the console: limbic.feel("praise")

const brain = new Brain(
  {
    act: (instructions, say) => {
      if (say) { showCaption("assistant", say); speak(say); }
      return executeInstructions(instructions);
    },
    isBusy: () => busyCount > 0,
    getPose: () => ({ ...Rig.getPosition(), headingDeg: Rig.getTurnDeg() }),
    getWorld: () => world,
  },
  {
    onUpdate: renderMind,
    onEvent: addLog,
    onFeel: (kind, detail) => limbic.feel(kind, detail),
    getChem: () => limbic.state(),
    onOutcome: (reward) => limbic.externalOutcome(reward),
    getLearning: () => limbic.learningState(),
    getSenses: () => {
      // what he sees = the camera + the arena objects in front of him
      const r = senses.read();
      const arena = arenaSights.slice(0, 5).map((s) => ({ label: s.label, side: (s.cx < 0.38 ? "left" : s.cx > 0.62 ? "right" : "center") as "left" | "center" | "right", near: s.size > 0.12, source: "arena" as const }));
      return { ...r, seen: [...(r.seen ?? []), ...arena] };
    },
    think: async (req) => askCortex(req, shareFrames && senses.cameraOn ? senses.snapshot() : null),
  }
);

function renderMind(m: MindSnapshot) {
  $("mindMood").textContent = m.mood;
  $("mindLast").textContent = m.lastAction;
  $("mindThought").textContent = m.thought;
  const set = (k: string, v: number, text: string) => {
    const b = document.querySelector<HTMLElement>(`#bars [data-k="${k}"]`); if (b) b.style.width = Math.round(v * 100) + "%";
    const t = document.querySelector<HTMLElement>(`#bars [data-v="${k}"]`); if (t) t.textContent = text;
  };
  for (const k of ["curiosity", "social", "boredom", "arousal"] as const) set(k, m[k], String(Math.round(m[k] * 100)));
  set("valence", (m.valence + 1) / 2, (m.valence >= 0 ? "+" : "") + m.valence.toFixed(2));
  const facts = [m.userName ? `knows you as ${m.userName}` : "doesn't know your name yet", `${m.interactions} conversations`, m.favorite ? `favorite: ${m.favorite.replace("_", " ")}` : ""];
  $("facts").textContent = facts.filter(Boolean).join(" · ");
}

function handleUserText(text: string) {
  lastUserSpeechAt = performance.now();
  showCaption("user", text);

  // Teach face / name: "my name is Ada", "this is Bob", "call me Sam", "I am Maya"
  const teach = text.match(/^(?:my name is|i(?:'m| am)|this is|call me|remember me as)\s+([a-zA-Z][\w' -]{0,36})$/i);
  if (teach) {
    void senses.teachPerson(teach[1]).then((r) => {
      if (r.ok) brain.noteSharedKnowledge(`their name is ${teach[1]}`);
      showCaption("assistant", r.message); speak(r.message); addLog("system", `teach: ${r.message}`);
    });
    return;
  }
  if (/^(forget (?:everyone|all names|all people)|clear names)$/i.test(text.trim())) {
    senses.forgetPerson();
    const reply = "okay, I forgot the names I learned";
    showCaption("assistant", reply); speak(reply); addLog("system", reply);
    return;
  }

  const local = brain.hear(text);
  if (!local) return;                                   // AI mode: the cortex will answer
  const stopNow = local.instructions.some((i) => i.op === "EXEC" && i.command === "WALK_STOP") && /stop/i.test(local.reply);
  const pause = stopNow ? 0 : 350 + Math.random() * 450; // a short beat before answering feels natural (but never delay a stop)
  if (stopNow) void executeInstructions(local.instructions);
  setTimeout(() => {
    showCaption("assistant", local.reply); speak(local.reply);
    if (!stopNow) void executeInstructions(local.instructions);
  }, pause);
}

// ----------------------------------------------------------------- safety --
function estop() {
  stopped = true; motionToken++;
  Rig.setStopped(true); Rig.setWalking(false); Rig.setDancing(false);
  window.speechSynthesis?.cancel();
  brain.setMode("off"); setModeUI("off");
  $("bodyState").textContent = "E-STOP"; $("estop").classList.add("armed"); $("estop").textContent = "RESUME";
  addLog("system", "EMERGENCY STOP: all motion halted, mind switched off");
}
function resume() { stopped = false; Rig.setStopped(false); $("estop").classList.remove("armed"); $("estop").textContent = "E-STOP"; $("bodyState").textContent = "Idle"; addLog("system", "resumed"); }
$("estop").addEventListener("click", () => ($("estop").classList.contains("armed") ? resume() : estop()));
window.addEventListener("keydown", (e) => { if (e.key === "Escape") estop(); });

// Reflexes, 20 Hz, never waiting for any decision maker: arena wall, obstacle steering, no-clipping.
setInterval(() => {
  const p = Rig.getPosition();
  if (!ARENA_INFINITE && Rig.isWalking() && Math.hypot(p.x, p.z) > ARENA * p.unit) {
    motionToken++; wandering = false; Rig.setWalking(false);
    Rig.setBodyTurn((Math.atan2(-p.x, -p.z) * 180) / Math.PI);
    brain.note("I bumped into the arena wall and stopped");
  }
  if (wandering && navActive === 0 && Rig.isWalking()) {         // free walking: steer around whatever is ahead
    const h = steering.heading(p, wanderHeading, obstacles, steerOpts());
    Rig.setBodyTurn(h);
  }
  const fix = resolveOverlap(p, obstacles, bodyR());             // last line of defense: never stand inside an object
  if (fix) { Rig.setPosition(fix.x, fix.z); if (wandering) brain.note("I bumped into something and stepped around it"); }
}, 50);

// ---------------------------------------------------------------- controls -
function setModeUI(m: Mode) { document.querySelectorAll<HTMLElement>("#modeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.mode === m)); }
document.querySelectorAll<HTMLElement>("#modeSeg button").forEach((b) => b.addEventListener("click", () => {
  if ($("estop").classList.contains("armed")) resume();
  brain.setMode(b.dataset.mode as Mode); setModeUI(b.dataset.mode as Mode);
}));

async function toggleDevice(box: HTMLInputElement, note: string, on: () => Promise<void>, off: () => void) {
  try { if (box.checked) { await on(); $(note).textContent = "on"; } else { off(); $(note).textContent = "off"; } }
  catch (e) { box.checked = false; $(note).textContent = "blocked"; addLog("system", `permission failed: ${(e as Error).message}`); }
}
$<HTMLInputElement>("tglCam").addEventListener("change", async (e) => {
  const box = e.target as HTMLInputElement;
  if (box.checked) $("pip").classList.add("show"); // a display:none video may never decode frames, so show it first
  await toggleDevice(box, "camNote", () => senses.enableCamera(), () => senses.disableCamera());
  $("pip").classList.toggle("show", senses.cameraOn);
  if (senses.cameraOn) {
    // Immediately orient toward the screen / viewer
    wandering = false;
    Rig.setWalking(false);
    Rig.faceViewer?.();
    Rig.setEyeAngle(90);
    gazeAngle = 90;
    gazeGoal = 90;
    $("bodyState").textContent = "Looking";
    addLog("system", "camera on — facing you");
  }
});
$<HTMLInputElement>("tglMic").addEventListener("change", (e) => {
  const box = e.target as HTMLInputElement;
  void toggleDevice(box, "micNote", async () => { await senses.enableMic(); speech.startListening(); }, () => { senses.disableMic(); speech.stopListening(); });
});
$<HTMLInputElement>("tglVoice").addEventListener("change", (e) => { voiceOn = (e.target as HTMLInputElement).checked; if (!voiceOn) window.speechSynthesis?.cancel(); });
$<HTMLInputElement>("tglShare").addEventListener("change", (e) => {
  shareFrames = (e.target as HTMLInputElement).checked;
  addLog("system", shareFrames ? "camera frames will be sent to the AI provider on each thought" : "frames stay on this device (the AI still gets text labels of what I see)");
});
document.querySelectorAll<HTMLElement>("#speedSeg button").forEach((b) => b.addEventListener("click", () => {
  const n = Number(b.dataset.speed); brain.setTimeScale(n); limbicScale = n;
  document.querySelectorAll<HTMLElement>("#speedSeg button").forEach((x) => x.classList.toggle("on", x === b));
}));
$("micBtn").addEventListener("click", () => (speech.isListening() ? speech.stopListening() : speech.startListening()));
$("talkForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("talkText"); const text = input.value.trim();
  if (text) { input.value = ""; handleUserText(text); }
});

senses.onEvent = (k) => brain.stimulus(k as Stimulus);
senses.onSight = (ev) => brain.sight(ev);

// The arena is part of what he sees: objects inside his field of view (about 130 degrees, 24 body-sizes) show up as sights.
const worldTracker = new SightTracker(2, 2500);
let arenaSights: Sight[] = [];
setInterval(() => {
  if (brain.mode === "off" || stopped || !world.length) return;
  const p = Rig.getPosition();
  const dets = worldDetections({ x: p.x, z: p.z, headingDeg: Rig.getTurnDeg(), unit: p.unit },
    world.map((o) => ({ id: o.id, label: arenaLabel(o.id), x: o.x, z: o.z, r: o.r ?? unit * 0.35 })));
  for (const ev of worldTracker.update(dets, performance.now())) brain.sight({ ...ev, source: "arena" });
  arenaSights = worldTracker.current();
}, 250);
senses.onStatus = (t) => { $("pipStatus").textContent = t; addLog("system", `vision: ${t}`); };

// What he sees, drawn over the preview (boxes) and summarised in the Mind panel.
const overlay = $<HTMLCanvasElement>("pipOverlay");
setInterval(() => {
  const ctx = overlay.getContext("2d");
  if (!ctx) return;
  const video = $<HTMLVideoElement>("cam");
  overlay.width = overlay.clientWidth || 240; overlay.height = overlay.clientHeight || 180;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const arenaNames = arenaSights.map((s) => `${s.label} (${s.cx < 0.38 ? "left" : s.cx > 0.62 ? "right" : "center"})`);
  if (!senses.cameraOn) { $("seeing").textContent = arenaNames.length ? `In the arena I see: ${arenaNames.join(", ")} · camera off` : "camera off · nothing in front of me"; return; }
  $("pipMotion").style.width = Math.round(senses.motion * 100) + "%";
  ctx.lineWidth = 2; ctx.font = "11px monospace";
  for (const s of senses.sights) {
    const x = (s.cx - s.w / 2) * overlay.width, y = (s.cy - s.h / 2) * overlay.height, w = s.w * overlay.width, h = s.h * overlay.height;
    const color = s.label === "person" || s.label === "someone" ? "#22c55e" : "#38bdf8";
    ctx.strokeStyle = color; ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = color; ctx.fillText(s.label, x + 3, Math.max(11, y - 3));
  }
  const names = senses.sights.map((s) => `${s.color && s.label !== "person" ? s.color + " " : ""}${s.label} (${s.cx < 0.38 ? "left" : s.cx > 0.62 ? "right" : "center"})`);
  const tier = senses.mode === "model" ? "naming objects" : senses.mode === "loading" ? "loading object model…" : "pixel mode: can see movement, can't name things";
  const cam = names.length ? `Camera: ${names.join(", ")}` : (video.videoWidth ? `camera: nothing yet · ${tier}` : "waiting for camera frames…");
  $("seeing").textContent = arenaNames.length ? `${cam} · Arena: ${arenaNames.join(", ")}` : cam;
}, 200);

// Gaze + body orientation toward the camera/user.
// Visual servoing on pixel error: turn until the person is centered (no accumulating yaw bug).
let gazeAngle = 90, gazeGoal = 90, nextSaccade = 0;
const glanceAtToy = (): number | null => {
  const p = Rig.getPosition(), toys = world.filter((o) => o.kind === "toy");
  if (!toys.length) return null;
  const o = toys[Math.floor(Math.random() * toys.length)];
  const rel = angleDiff((Math.atan2(o.x - p.x, o.z - p.z) * 180) / Math.PI, Rig.getTurnDeg());
  return clamp(90 + eyeDir() * clamp(rel, -50, 50) * 0.8, 35, 145);
};
setInterval(() => {
  if (brain.mode === "off" || stopped) return;
  const now = performance.now();
  const camOn = senses.cameraOn;
  const target = camOn ? senses.gazeTarget() : null;
  const person = camOn && (senses.personPresent || !!target);

  // Someone on camera → stop free wandering so he can face you
  if (person && wandering && navActive === 0) {
    wandering = false;
    Rig.setWalking(false);
    $("bodyState").textContent = "Looking";
  }

  if (eyeLock > 0) {
    // Scripted action owns the eyes this frame
  } else if (now - lastUserSpeechAt < 4000) {
    gazeGoal = 90; // eye contact while you talk
  } else if (target) {
    const err = target.cx - 0.5; // >0 → person on the right of the preview
    gazeGoal = clamp(90 + eyeDir() * err * 2 * 60, 20, 160);
  } else if (camOn) {
    gazeGoal = 90; // camera on, no target yet → look straight at the lens
  } else if (now > nextSaccade) {
    const m = brain.mood();
    const spread = Rig.isWalking() ? 8 : m === "curious" || m === "bored" ? 38 : m === "attentive" ? 14 : 22;
    gazeGoal = Math.random() < 0.18 ? glanceAtToy() ?? 90 : 90 + (Math.random() * 2 - 1) * spread;
    nextSaccade = now + 1200 + Math.random() * 3200;
  }

  if (eyeLock <= 0) {
    gazeAngle += (gazeGoal - gazeAngle) * 0.35;
    Rig.setEyeAngle(clamp(gazeAngle, 0, 180));
  }

  // Face the screen / viewer when camera is on; fine-tune with pixel error
  if (navActive === 0 && !Rig.isWalking() && camOn) {
    // Base: orient body toward the 3D view camera (the user looking at the page)
    const faceDeg = typeof Rig.faceViewer === "function" ? (Rig.getViewThetaDeg?.() ?? 0) : 0;
    const err = target ? (target.cx - 0.5) : 0;
    // Absolute heading = face screen + small offset from where the person sits in frame
    const desired = faceDeg + eyeDir() * err * 40;
    const cur = Rig.getBodyTurn();
    const diff = angleDiff(desired, cur);
    if (Math.abs(diff) > 1) Rig.setBodyTurn(cur + clamp(diff, -8, 8));
  }
}, 50);

document.querySelectorAll<HTMLElement>("[data-stim]").forEach((b) => b.addEventListener("click", () => {
  const k = b.dataset.stim!;
  if (k === "teleport") { const a = Math.random() * 6.28; Rig.setPosition(Math.sin(a) * 34 * unit, Math.cos(a) * 34 * unit); brain.stimulus("teleport"); }
  else if (k === "skip") { brain.fastForward(60); for (let i = 0; i < 240; i++) limbic.step(0.25); }
  else if (k === "teach") {
    const name = prompt("What should I call you? (face the camera, good light)");
    if (name) {
      void senses.teachPerson(name).then((r) => {
        showCaption("assistant", r.message); speak(r.message); addLog("system", `teach: ${r.message}`);
      });
    }
  }
  else if (k === "reset") {
    try {
      localStorage.removeItem("vision.mind.v3");
      localStorage.removeItem("vision.brain.learn.v1");
      localStorage.removeItem("vision.knownPeople.v1");
      localStorage.removeItem("vision.faceEmbeddings.v1");
    } catch { /* ignore */ }
    location.reload();
  }
  else if (k === "gift") {
    const id = `toy_${Math.random().toString(36).slice(2, 5)}`; const p = Rig.getPosition(); const a = Math.random() * 6.28;
    const o: WorldObject = { id, kind: "toy", x: p.x + Math.sin(a) * 8 * unit, z: p.z + Math.cos(a) * 8 * unit, color: "#f59e0b" };
    world.push(o); obstacles.push({ id, x: o.x, z: o.z, r: unit * 0.35 }); Rig.addProp({ id, kind: "toy", x: o.x, z: o.z, color: 0xf59e0b, radius: unit }); brain.stimulus("gift");
  } else brain.stimulus(k as Stimulus);
}));

// -------------------------------------------------------------------- boot --
fetchHealth().then((h) => {
  const b = $("llmBadge"), t = b.querySelector("span")!;
  if (!h) { t.textContent = "server unreachable"; b.classList.add("warn"); return; }
  t.textContent = h.llm.configured ? `LLM: ${h.llm.provider} · ${h.llm.model}` : "AI mind: no API key, falls back to local";
  b.classList.add(h.llm.configured ? "good" : "warn");
});

Rig.ready.then(() => { placeProps(); brain.start(); }).catch(() => addLog("system", "3D model failed to load"));
