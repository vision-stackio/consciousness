/**
 * Vision's mind. Two layers share one body of state:
 *
 *   drives + emotion + 3-tier memory   (always running, local, free)
 *   decision maker                     "local" = utility AI + learning
 *                                      "ai"    = LLM cortex chooses, validated here
 *
 * Reflexes (startle, arena wall) never wait for the LLM.
 * Honest framing: this is a simulated mind. It is autonomous, not conscious.
 */

export type Instr =
  | { op: "EXEC"; command: string; arg?: number | string }
  | { op: "SLEEP"; ms: number };

export interface Pose { x: number; z: number; unit: number; headingDeg: number }
export interface WorldObject { id: string; kind: "toy" | "landmark"; x: number; z: number; color: string; r?: number }
export type Mode = "off" | "local" | "ai";
export type Stimulus = "praise" | "scold" | "loud_noise" | "gift" | "poke" | "motion" | "dark" | "bright" | "ignored" | "teleport";
export type EventType = "percept" | "thought" | "action" | "speech" | "memory" | "system";

export interface Body {
  act(instructions: Instr[], say?: string): Promise<void>;
  isBusy(): boolean;
  getPose(): Pose;
  getWorld(): WorldObject[];
}

import type { Sight, SightEvent } from "./vision.js";
import { respond, learnFrom, refusal, pickFresh, SIGHT_REACTS, type Command, type DialogueContext } from "./dialogue.js";
import type { FeelKind, LimbicState } from "./limbic.js";
import { CHEMS } from "./brainsim/chem.js";
export type { Sight, SightEvent };
export interface SenseReading {
  motion: number; brightness: number; loudness: number; camera: boolean; mic: boolean;
  seen?: { label: string; side: "left" | "center" | "right"; near: boolean; color?: string; score?: number; source?: "camera" | "arena" }[];  // what he sees now: on the camera and in the arena
  personPresent?: boolean;
  visionMode?: "off" | "pixels" | "model";
}

export interface MindSnapshot {
  mode: Mode; mood: string; valence: number; arousal: number;
  curiosity: number; social: number; boredom: number;
  thought: string; lastAction: string; interactions: number; userName?: string; favorite?: string;
}

export interface CortexRequest {
  state: MindSnapshot;
  pose: { x: number; z: number; headingDeg: number; distFromHome: number };
  world: { id: string; kind: string; distance: number; bearing: number }[];
  memory: { working: string[]; lessons: string[]; userName?: string; interactions: number; favorite?: string; facts: Record<string, string>; traits: { playful: number; shy: number } };
  conversation: { who: "user" | "you"; text: string }[];
  brain?: { emotion: string; intensity: number; because: string; instinct: string; hormones: Record<string, number> }; // read out of his neural model
  senses: SenseReading;
  events: string[];
  heard?: string;
  recent: string[];
  sinceUserSec: number;
}

export interface Decision {
  thought: string;
  say?: string | null;
  action: { type: string; target?: string; angle?: number; duration_ms?: number };
  emotion?: { valence?: number; arousal?: number };
  remember?: string | null;
  next_think_in_s?: number;
}

export interface BrainOptions {
  onUpdate?: (s: MindSnapshot) => void;
  onEvent?: (type: EventType, text: string) => void;
  /** Ask the LLM cortex. Throw on failure; the brain falls back to local decisions. */
  think?: (req: CortexRequest) => Promise<Decision>;
  getSenses?: () => SenseReading;
  /** Tell the emotional brain what happened to him (it answers with chemistry). */
  onFeel?: (kind: FeelKind, detail?: string) => void;
  /** Read back the emotional brain: emotion + hormones. They bias what he wants to do. */
  getChem?: () => LimbicState | undefined;
  /** Explore toward unvisited places instead of random headings (default true). */
  smartExplore?: boolean;
  storageKey?: string;
  timeScale?: number;
  now?: () => number;
}

type ActionName = "wander" | "look_around" | "dance" | "rest" | "call_out" | "murmur" | "go_home" | "play" | "watch";
const ACTIONS: ActionName[] = ["wander", "look_around", "dance", "rest", "call_out", "murmur", "go_home", "play", "watch"];
interface Plan { instr: Instr[]; say?: string; reason: string; effect: ActionName | null; label?: string }

export const ARENA = 40; // arena radius, in body-sizes
const CELL = 8;

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (v: number) => Math.round(v * 100) + "%";
const norm180 = (a: number) => (((a % 360) + 540) % 360) - 180;
const exec = (command: string, arg?: number | string): Instr => (arg === undefined ? { op: "EXEC", command } : { op: "EXEC", command, arg });
const sleep = (ms: number): Instr => ({ op: "SLEEP", ms: Math.round(ms) });
const stopAll = (): Instr => exec("WALK_STOP");
const cleanSay = (s: unknown) => (typeof s === "string" ? s.replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, 240) : "");

// ---------------------------------------------------------------- memory ---
interface Episode { t: number; kind: string; detail: string; valence: number; salience: number; promoted?: boolean }
interface LongTerm {
  userName?: string; interactions: number; firstMetAt: number; lastSeenAt: number;
  actionValue: Partial<Record<ActionName, number>>; cells: string[]; lessons: string[]; favorite?: ActionName;
  ctxValue: Record<string, number>;                 // what worked in which situation ("curious|alone|wander")
  seen: Record<string, number>;                     // how many times each kind of thing has been seen
  traits: { playful: number; shy: number };         // personality that drifts with experience
  facts: Record<string, string>;                    // things the user told him ("favorite color": "blue")
}

/** Tiers: working (last 7), episodic (decays), long-term (consolidated, persisted). */
export class Memory {
  working: string[] = [];
  episodes: Episode[] = [];
  long: LongTerm = { interactions: 0, firstMetAt: 0, lastSeenAt: 0, actionValue: {}, cells: [], lessons: [], ctxValue: {}, seen: {}, traits: { playful: 0.5, shy: 0.5 }, facts: {} };

  constructor(private key: string, private now: () => number) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) { const d = JSON.parse(raw); this.long = { ...this.long, ...d.long, traits: { ...this.long.traits, ...(d.long?.traits ?? {}) } }; this.episodes = d.episodes ?? []; }
    } catch { /* storage unavailable */ }
  }
  remember(kind: string, detail: string, valence = 0, salience = 0.3) {
    this.working.push(`${kind}: ${detail}`);
    if (this.working.length > 7) this.working.shift();
    this.episodes.push({ t: this.now(), kind, detail, valence, salience });
    if (this.episodes.length > 200) this.episodes.shift();
  }
  consolidate() {
    for (const e of this.episodes) {
      e.salience *= 0.97;
      if (e.salience > 0.55 && !e.promoted) {
        e.promoted = true;
        this.long.lessons.push(`${e.kind}: ${e.detail}`);
        if (this.long.lessons.length > 20) this.long.lessons.shift();
      }
    }
    this.episodes = this.episodes.filter((e) => e.salience > 0.08);
    const best = (Object.entries(this.long.actionValue) as [ActionName, number][]).sort((a, b) => b[1] - a[1])[0];
    this.long.favorite = best && best[1] > 0.05 ? best[0] : undefined;
    this.save();
  }
  save() {
    try { localStorage.setItem(this.key, JSON.stringify({ long: this.long, episodes: this.episodes.slice(-50) })); } catch { /* ignore */ }
  }
}

const MURMURS: Record<string, string[]> = {
  happy: ["I feel good right now.", "Everything feels a bit brighter."],
  afraid: ["My heart is racing. What was that?", "I don't like this. I'm keeping watch."],
  angry: ["That wasn't nice.", "I'm still a little upset."],
  sad: ["I feel a bit low.", "It's a grey kind of moment."],
  disgusted: ["Ugh. Something's off."],
  hurt: ["Ow. That still stings."],
  sleepy: ["Mm. Heavy eyelids."],
  excited: ["I feel like moving!", "Everything feels interesting right now."],
  startled: ["Whoa, what was that?"],
  lonely: ["It's quiet. I wonder where you are.", "Is anyone there?"],
  bored: ["Nothing is happening. I'll find something to do.", "Time to shake things up."],
  curious: ["I wonder what's over there.", "I haven't seen that corner yet."],
  content: ["Nice and calm.", "This is a good spot."],
  calm: ["Just thinking.", "All quiet."],
};

// ----------------------------------------------------------------- brain ---
export class Brain {
  mode: Mode = "local";
  private curiosity = 0.5; private social = 0.4; private boredom = 0.2;
  private valence = 0.1; private arousal = 0.3;

  private thought = "Just woke up.";
  private lastAction: string = "";
  private recent: ActionName[] = [];
  private journal: string[] = [];
  private notable: string[] = [];
  private toyCooldown = new Map<string, number>();
  private lastUserAt = -1e12;
  private lastDecisionAt: number;
  private nextGap = 3000;
  private lastSpokeAt = 0;
  private habit: Record<string, number> = {};          // habituation: repeated stimuli matter less
  private personSince = 0;
  private lastPersonAt = -1e12;
  private sightSaid = new Map<string, number>();         // per-label comment cooldown
  private spoken: string[] = [];                         // last things he said, to avoid repeating himself
  private convo: { who: "user" | "you"; text: string }[] = [];
  private lastTopic: string | undefined;
  private tonicAt: Record<string, number> = {};
  private trace = "";                                    // why the last local decision was made
  private acting = 0;
  private thinking = false;
  private urgent = false;
  private pendingHeard: string | null = null;
  private ticks = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private now: () => number;
  private scale: number;
  readonly memory: Memory;

  constructor(private body: Body, private opts: BrainOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.scale = opts.timeScale ?? 1;
    this.memory = new Memory(opts.storageKey ?? "vision.mind.v3", this.now);
    this.lastDecisionAt = this.now();
  }

  // ----- lifecycle
  start() {
    if (this.timer) return;
    const m = this.memory.long;
    const hello = m.userName ? `Welcome back, ${m.userName}.` : m.interactions > 0 ? "Good to see you again." : "Hello? I just woke up.";
    this.thought = m.interactions > 0 ? "I remember being here before." : "First time awake. Looking around.";
    this.event("system", this.thought);
    void this.say(hello);
    m.lastSeenAt = this.now();
    this.timer = setInterval(() => this.tick(), 1000);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  setMode(m: Mode) { this.mode = m; this.event("system", `mind mode: ${m}`); this.emit(); }
  setTimeScale(n: number) { this.scale = Math.max(1, n); }
  /** Skip time forward (drives only, no decisions). */
  fastForward(seconds: number) { this.drift(seconds); this.event("system", `${seconds}s pass...`); this.emit(); }
  /** Add a note the AI cortex will see on its next think. */
  note(text: string) { this.notable.push(text); if (this.notable.length > 8) this.notable.shift(); this.event("percept", text); }

  // ----- perception
  notice() { this.lastUserAt = this.now(); this.arousal = clamp(this.arousal + 0.03); }

  /** Sandbox / sensor stimuli. Appraise immediately, react by reflex, let the cortex think about it. */
  stimulus(kind: Stimulus) {
    const f = ["motion", "loud_noise", "dark", "bright", "poke"].includes(kind) ? this.habituate(kind) : 1; // 1 = fresh, lower = used to it
    const v = (d: number) => (this.valence = clamp(this.valence + d * f, -1, 1));
    const a = (d: number) => (this.arousal = clamp(this.arousal + d * f));
    const tr = this.memory.long.traits;
    let text = "";
    switch (kind) {
      case "praise": tr.playful = clamp(tr.playful + 0.03); tr.shy = clamp(tr.shy - 0.02); v(0.35); a(0.2); this.social = clamp(this.social - 0.25); text = "someone praised me"; this.lastUserAt = this.now(); break;
      case "scold": tr.shy = clamp(tr.shy + 0.04); tr.playful = clamp(tr.playful - 0.02); v(-0.4); a(0.25); text = "someone scolded me"; this.lastUserAt = this.now(); break;
      case "loud_noise": tr.shy = clamp(tr.shy + 0.01); a(0.5); v(-0.2); text = "a loud noise nearby"; this.reflex([stopAll(), exec("EYE_SET", 60), sleep(250), exec("EYE_SET", 120), sleep(250), exec("EYE_CENTER")]); break;
      case "gift": tr.playful = clamp(tr.playful + 0.02); v(0.3); this.boredom = clamp(this.boredom - 0.3); a(0.2); text = "someone dropped a new toy nearby"; break;
      case "poke": a(0.3); v(0.05); text = "I was poked"; this.lastUserAt = this.now(); break;
      case "motion": a(0.2); this.social = clamp(this.social - 0.08 * f); text = "sudden movement in front of my camera"; if (f > 0.6) this.react(pick(["Whoa, what moved?", "Hey! I saw that."])); break;
      case "dark": v(-0.1); a(-0.1); text = "the lights went out"; this.react("Hey, who turned off the lights?"); break;
      case "bright": a(0.1); text = "the lights came on"; this.react("Ooh, that got bright!"); break;
      case "teleport": a(0.4); v(-0.15); text = "I got picked up and put down somewhere else"; break;
      case "ignored": this.social = clamp(this.social + 0.4); this.boredom = clamp(this.boredom + 0.3); text = "nobody has talked to me for a long time"; break;
    }
    this.feel(kind);
    this.note(text);
    this.memory.remember("event", text, this.valence, 0.6 * f + 0.1);
    if (this.mode === "ai" && !["motion", "dark", "bright"].includes(kind)) this.urgent = true;
    this.emit();
  }

  /**
   * Something appeared in (or left) his view: on the camera, or in the arena around him.
   * Local reaction first (so it works without any AI); the AI cortex also gets a note.
   */
  sight(ev: SightEvent) {
    const long = this.memory.long, now = this.now();
    const person = ev.label === "person" || ev.label === "someone";
    const where = ev.side === "center" ? "in front of me" : `on my ${ev.side}`;
    const art = (w: string) => (/^[aeiou]/i.test(w) ? "an " : "a ") + w;

    // ---- things in the arena around him (toys, scenery)
    if (ev.source === "arena") {
      if (ev.type !== "appeared") return;
      long.seen[ev.label] = (long.seen[ev.label] ?? 0) + 1;
      this.feel("arena_seen", ev.label);
      this.note(`I can see the ${ev.label} ${where}`);
      this.memory.remember("saw", `the ${ev.label}`, 0.05, 0.25);
      if (/toy/.test(ev.label)) this.valence = clamp(this.valence + 0.05, -1, 1);
      if (now - (this.sightSaid.get(ev.label) ?? -1e12) > 60000 && !this.userRecent(4000) && Math.random() < 0.6) {
        this.sightSaid.set(ev.label, now);
        this.react(this.fresh([`There's the ${ev.label}.`, `Ooh, the ${ev.label}!`, `I can see the ${ev.label} ${where}.`]));
      }
      this.emit(); return;
    }

    // ---- things on the camera
    if (ev.type === "appeared") {
      long.seen[ev.label] = (long.seen[ev.label] ?? 0) + 1;
      if (person) {
        const away = now - this.lastPersonAt;
        this.lastPersonAt = now; this.personSince = now;
        this.social = clamp(this.social - 0.5);
        this.valence = clamp(this.valence + 0.25, -1, 1); this.arousal = clamp(this.arousal + 0.25);
        long.traits.shy = clamp(long.traits.shy - 0.01);
        this.feel("person_arrived");
        this.note(`a person appeared ${where}${ev.near ? " (close)" : ""}`);
        this.memory.remember("saw", `a person ${where}`, 0.3, 0.6);
        if (away > 45000) this.react(long.userName ? `Hey ${long.userName}, there you are!` : pick(["Oh, hello!", "Someone's here!", "Hi there!"]), true);
        if (this.mode === "ai") this.urgent = true;
      } else {
        const r = SIGHT_REACTS[ev.label];
        const n = long.seen[ev.label];
        const desc = [ev.color, ev.label].filter(Boolean).join(" ");
        // big, near the middle, and not a person: someone is holding it up to the camera
        const shown = (ev.size ?? 0) > 0.07 && Math.abs((ev.cx ?? 0.5) - 0.5) < 0.3;
        this.curiosity = clamp(this.curiosity - (shown ? 0.25 : 0.15));
        this.valence = clamp(this.valence + (r?.v ?? 0.05) + (shown ? 0.05 : 0), -1, 1); this.arousal = clamp(this.arousal + (r?.a ?? 0.05) + (shown ? 0.15 : 0));
        this.feel(shown ? "object_shown" : "object_seen", ev.label);
        this.note(shown ? `someone is showing me ${art(desc)}` : `I see ${art(desc)} ${where}`);
        this.memory.remember("saw", art(desc), r?.v ?? 0.05, shown ? 0.9 : n === 1 ? 0.7 : 0.3);
        if (shown) {
          this.lastUserAt = now - 4000;            // someone is engaging with him: don't wander off mid-show
          this.sightSaid.set(ev.label, now);
          const line = r ? `Ooh! ${pick(r.say)}` : this.fresh([`Ooh! ${cap(art(desc))}. Let me look.`, `What's that? ${cap(art(desc))}?`, `You're showing me ${art(desc)}!`]);
          this.react(n > 3 ? `${cap(art(desc))} again. You really like showing me that.` : line, true);
          if (this.mode === "ai") this.urgent = true;
        } else if (now - (this.sightSaid.get(ev.label) ?? -1e12) > 90000 && !this.userRecent(6000)) {
          this.sightSaid.set(ev.label, now);
          this.react(n > 2 ? `That ${ev.label} again.` : pick(r?.say ?? [`I see ${art(desc)}.`, `Oh, ${art(desc)}.`]));
        }
      }
    } else if (person) {
      this.personSince = 0;
      this.social = clamp(this.social + 0.12);
      this.feel("person_left");
      this.note("the person left my view");
      this.memory.remember("saw", "the person left", -0.1, 0.4);
      if ((ev.durationMs ?? 0) > 15000) this.react(pick(["Bye for now!", "Where did you go?"]));
    }
    this.emit();
  }

  /**
   * A finished sentence from the user. Returns an immediate reply when the local mind
   * handles it, or null (AI mode: the cortex answers). "Stop" is always obeyed.
   * Everything else, Vision decides: he may refuse, and he answers from his real state.
   */
  hear(text: string): { reply: string; instructions: Instr[] } | null {
    const t = text.toLowerCase();
    this.lastUserAt = this.now();
    const long = this.memory.long;
    long.interactions++; long.lastSeenAt = this.now();
    if (!long.firstMetAt) long.firstMetAt = this.now();
    const good = /\b(good|great|nice|love|awesome|cool|thanks|thank|friend|well done)\b/.test(t) ? 1 : 0;
    const bad = /\b(bad|stupid|hate|ugly|useless|shut up)\b/.test(t) ? 1 : 0;
    this.social = clamp(this.social - 0.5); this.boredom = clamp(this.boredom - 0.3);
    this.arousal = clamp(this.arousal + 0.25);
    this.valence = clamp(this.valence + 0.1 + 0.25 * good - 0.35 * bad, -1, 1);
    this.event("percept", `heard: "${text.slice(0, 80)}"`);
    this.memory.remember("heard", text.slice(0, 60), this.valence, 0.5 + 0.3 * (good + bad));
    this.convoPush("user", text);
    this.feel("heard", text);

    // remember what the user tells him, in every mode (the AI cortex sees these facts too)
    const learned = learnFrom(text);
    if (learned.name) { long.userName = learned.name; this.memory.remember("learned", `you are called ${learned.name}`, 0.4, 0.9); }
    for (const [k, v] of learned.facts) {
      long.facts[k] = k === "likes" && long.facts.likes && !long.facts.likes.includes(v) ? `${long.facts.likes}, ${v}`.slice(-80) : v;
      this.memory.remember("learned", `your ${k} is ${v}`, 0.3, 0.8);
    }
    if (learned.name || learned.facts.length) this.memory.save();

    if (/\b(stop|halt|freeze)\b/.test(t)) return this.say_("Okay, stopping.", [stopAll()]);
    if (this.mode === "ai") {
      if (this.thinking) this.pendingHeard = text; else void this.think(text);
      return null;
    }

    const ctx = this.dialogueCtx();
    const res = respond(text, ctx);
    if (!res) return null;
    this.lastTopic = res.topic;
    if (res.effects) {
      this.valence = clamp(this.valence + (res.effects.valence ?? 0), -1, 1);
      this.arousal = clamp(this.arousal + (res.effects.arousal ?? 0));
      this.social = clamp(this.social + (res.effects.social ?? 0));
    }
    if (!res.command) return this.say_(res.reply, []);
    return this.runCommand(res.command, res.reply, ctx);
  }

  /** He decides whether he feels like doing what was asked. */
  private runCommand(cmd: Command, reply: string, ctx: DialogueContext): { reply: string; instructions: Instr[] } {
    const effortful = cmd === "dance" || cmd === "walk" || cmd === "play";
    if (effortful && !this.willing(cmd === "dance")) {
      this.memory.remember("refused", cmd, -0.1, 0.5);
      this.feel("refused");
      return this.say_(refusal(ctx), []);
    }
    this.memory.remember("obeyed", cmd, 0.1, 0.3);
    this.feel("obeyed");
    const turn = (c: string, n = 1) => Array.from({ length: n }, () => exec(c, 600));
    switch (cmd) {
      case "dance": return this.say_(reply, [exec("DANCE"), sleep(6000), stopAll()]);
      case "walk": return this.say_(reply, [exec("WALK_FORWARD"), sleep(4000), stopAll()]);
      case "turn_left": return this.say_(reply, turn("TURN_LEFT"));
      case "turn_right": return this.say_(reply, turn("TURN_RIGHT"));
      case "turn_around": return this.say_(reply, turn("TURN_RIGHT", 2));
      case "rest": return this.say_(reply, [stopAll(), exec("EYE_SET", 60), sleep(5000), exec("EYE_CENTER")]);
      case "look": return this.say_(reply, [exec("EYE_SET", 40), sleep(800), exec("EYE_SET", 140), sleep(800), exec("EYE_CENTER")]);
      case "look_at_me": case "come": return this.say_(reply, [exec("EYE_CENTER")]);
      case "play": {
        const toy = this.freeToy();
        if (!toy) return this.say_("I've played with all the toys for now. Drop me a new one?", []);
        const u = this.body.getPose().unit;
        return this.say_(reply, [exec("GOTO", `${toy.x},${toy.z},${2.2 * u}`), exec("DANCE"), sleep(1500), stopAll()]);
      }
    }
  }

  private say_(reply: string, instructions: Instr[]) { this.event("speech", reply); return { reply, instructions }; }
  private convoPush(who: "user" | "you", text: string) { this.convo.push({ who, text: text.slice(0, 160) }); if (this.convo.length > 8) this.convo.shift(); }

  private dialogueCtx(): DialogueContext {
    const m = this.memory.long, sn = this.opts.getSenses?.();
    return {
      mood: this.mood(), valence: this.valence, arousal: this.arousal, curiosity: this.curiosity, social: this.social, boredom: this.boredom,
      userName: m.userName, facts: m.facts, interactions: m.interactions, thought: this.thought, lastAction: this.lastAction, favorite: m.favorite,
      traits: m.traits, chem: this.chemSummary(), camera: sn?.camera ?? false, seen: sn?.seen ?? [], personPresent: sn?.personPresent ?? false, visionMode: sn?.visionMode,
      lastSaid: this.spoken, lastTopic: this.lastTopic, date: new Date(this.now()),
    };
  }

  /** A line he hasn't said recently. */
  private fresh(lines: string[]): string { return pickFresh(lines, this.spoken, Math.random); }

  /** Something from his own past, said out loud. Gives him an inner life. */
  private recallLine(): string | null {
    const now = this.now(), name = this.memory.long.userName;
    const eps = this.memory.episodes.filter((e) => e.salience > 0.45 && now - e.t > 20000 && ["played", "discovered", "saw", "refused", "learned", "event"].includes(e.kind));
    if (!eps.length) return null;
    const e = eps[Math.floor(Math.random() * eps.length)];
    const noun = e.detail.replace(/^an? /, "");
    switch (e.kind) {
      case "played": { const toy = e.detail.replace(/^toy_(\w+)$/, "the $1 toy"); return this.fresh([`I had fun with ${toy} earlier.`, `I keep thinking about ${toy}.`]); }
      case "discovered": return this.fresh(["I found a new corner of the arena earlier. I want to find more.", "That new spot I found earlier was interesting."]);
      case "saw": return e.detail.includes("person") ? this.fresh(["It was nice when someone showed up earlier.", name ? `I liked it when you were here, ${name}.` : "I liked having company earlier."]) : this.fresh([`That ${noun} earlier was interesting.`, `I keep thinking about that ${noun}.`]);
      case "refused": return "I told someone no earlier. I hope that was okay.";
      case "learned": return name ? this.fresh([`I still remember that you're ${name}.`]) : null;
      case "event": return this.fresh([`I remember that ${e.detail}.`]);
    }
    return null;
  }

  // ----- the loop
  tick() {
    this.drift(this.scale);
    if (++this.ticks % 15 === 0) this.memory.consolidate();
    this.emit();
    if (this.mode === "off" || this.acting > 0 || this.thinking || this.body.isBusy()) return;

    // brainstem: arena safety overrides whatever the decision maker would do
    if (this.distHome() > ARENA * 0.9) { void this.runLocal("go_home"); return; }

    const gap = (this.personPresent() ? Math.min(this.nextGap, 2500) : this.nextGap) / this.scale; // more responsive with company
    if (!(this.urgent || (!this.userRecent(8000) && this.now() - this.lastDecisionAt > gap))) return;
    this.urgent = false;
    if (this.mode === "local") void this.runLocal(this.choose());
    else void this.think();
  }

  private drift(dt: number) {
    this.curiosity = clamp(this.curiosity + 0.008 * dt);
    this.social = clamp(this.social + 0.005 * dt * (this.userRecent(30000) ? 0.2 : 1));
    this.boredom = clamp(this.boredom + 0.006 * dt);
    for (const k of Object.keys(this.habit)) this.habit[k] = Math.min(1, this.habit[k] + 0.01 * dt);
    const ch = this.chem()?.nm;
    // hormones move his emotional baseline: serotonin/oxytocin/dopamine/endorphin lift it, cortisol sinks it
    const chemV = ch ? 0.35 * (ch.serotonin - 0.4) + 0.3 * (ch.oxytocin - 0.1) + 0.25 * (ch.endorphin - 0.1) + 0.3 * (ch.dopamine - 0.1) - 0.5 * (ch.cortisol - 0.1) : 0;
    const chemA = ch ? 0.4 * (ch.noradrenaline - 0.1) + 0.3 * (ch.adrenaline - 0.05) - 0.3 * (ch.melatonin - 0.1) : 0;
    const base = 0.15 - 0.4 * Math.max(0, this.social - 0.6) - 0.3 * Math.max(0, this.boredom - 0.7) + chemV;
    const k = Math.min(1, 0.03 * dt);
    this.valence = clamp(this.valence + (base - this.valence) * k, -1, 1);
    this.arousal = clamp(this.arousal + (0.25 + chemA - this.arousal) * Math.min(1, 0.08 * dt));
    // strong needs are felt by the emotional brain too (rate-limited)
    const t = this.now();
    const tonic = (kind: FeelKind, on: boolean) => { if (on && t - (this.tonicAt[kind] ?? -1e12) > 6000) { this.tonicAt[kind] = t; this.feel(kind); } };
    tonic("lonely", this.social > 0.78 && !this.personPresent());
    tonic("bored", this.boredom > 0.78);
    tonic("wondering", this.curiosity > 0.72);
    tonic("company", this.personPresent());       // having someone around is quietly rewarding (oxytocin)
  }

  // ----- AI cortex
  private async think(heard?: string) {
    if (!this.opts.think) { this.event("system", "no cortex configured, using local mind"); return this.runLocal(this.choose()); }
    this.thinking = true;
    this.event("system", heard ? "thinking about what I heard..." : "thinking...");
    try {
      const req = this.buildRequest(heard);
      const d = await this.opts.think(req);
      await this.runDecision(d);
    } catch (e) {
      this.event("system", `cortex unavailable (${(e as Error).message}); falling back to local mind`);
      if (!heard) await this.runLocal(this.choose());
    } finally {
      this.thinking = false;
      this.lastDecisionAt = this.now();
      const h = this.pendingHeard; this.pendingHeard = null;
      if (h) void this.think(h);
    }
  }

  private buildRequest(heard?: string): CortexRequest {
    const p = this.body.getPose();
    const world = this.body.getWorld().map((o) => {
      const dx = o.x - p.x, dz = o.z - p.z;
      return { id: o.id, kind: o.kind, distance: Math.round((Math.hypot(dx, dz) / p.unit) * 10) / 10, bearing: Math.round(norm180((Math.atan2(dx, dz) * 180) / Math.PI - p.headingDeg)) };
    });
    const m = this.memory.long;
    return {
      state: this.snapshot(),
      pose: { x: Math.round(p.x / p.unit), z: Math.round(p.z / p.unit), headingDeg: Math.round(norm180(p.headingDeg)), distFromHome: Math.round(this.distHome()) },
      world,
      memory: { working: [...this.memory.working], lessons: m.lessons.slice(-5), userName: m.userName, interactions: m.interactions, favorite: m.favorite, facts: m.facts, traits: m.traits },
      conversation: this.convo.slice(-8),
      brain: this.brainReport(),
      senses: this.opts.getSenses?.() ?? { motion: 0, brightness: 0.5, loudness: 0, camera: false, mic: false },
      events: this.notable.splice(0),
      heard,
      recent: this.journal.slice(-6),
      sinceUserSec: Math.min(3600, Math.round((this.now() - this.lastUserAt) / 1000)),
    };
  }

  private async runDecision(d: Decision) {
    this.thought = String(d.thought ?? "").slice(0, 240) || "…";
    this.event("thought", this.thought);
    if (d.emotion) {
      this.valence = clamp(this.valence + clamp(Number(d.emotion.valence ?? 0), -0.3, 0.3), -1, 1);
      this.arousal = clamp(this.arousal + clamp(Number(d.emotion.arousal ?? 0), -0.3, 0.3));
    }
    if (d.remember) this.memory.remember("note", cleanSay(d.remember).slice(0, 120), 0.2, 0.7);
    this.nextGap = clamp(Number(d.next_think_in_s ?? 8), 3, 30) * 1000;
    const plan = this.planFromDecision(d);
    await this.execute(plan);
  }

  private planFromDecision(d: Decision): Plan {
    const a = d.action ?? { type: "idle" };
    const say = cleanSay(d.say) || undefined;
    const dur = (lo: number, hi: number, def: number) => clamp(Number(a.duration_ms ?? def), lo, hi);
    const p = this.body.getPose();
    const label = a.type + (a.target ? ` ${a.target}` : "");
    switch (a.type) {
      case "look": return { instr: [exec("EYE_SET", clamp(Number(a.angle ?? 90), 0, 180)), sleep(1000), exec("EYE_CENTER")], say, reason: label, label, effect: "look_around" };
      case "turn": return { instr: [exec("FACE", p.headingDeg + clamp(Number(a.angle ?? 90), -180, 180)), sleep(700)], say, reason: label, label, effect: null };
      case "wander": return { ...this.planWander(dur(1500, 8000, 4000)), say, reason: label, label };
      case "go_to": {
        const t = this.resolveTarget(String(a.target ?? ""));
        if (!t) { this.event("system", `unknown target "${a.target}", ignoring`); return { instr: [], say, reason: "idle", label: "idle", effect: null }; }
        return { instr: [exec("GOTO", `${t.x},${t.z},${t.stop}`)], say, reason: label, label, effect: "wander" };
      }
      case "dance": return { instr: [exec("DANCE"), sleep(dur(3000, 9000, 5000)), stopAll()], say, reason: label, label, effect: "dance" };
      case "rest": return { instr: [stopAll(), exec("EYE_SET", 60), sleep(dur(3000, 10000, 6000)), exec("EYE_CENTER")], say, reason: label, label, effect: "rest" };
      case "stop": return { instr: [stopAll()], say, reason: label, label, effect: null };
      default: return { instr: [], say, reason: "idle", label: "idle", effect: say ? "murmur" : null };
    }
  }

  // ----- local decision maker (utility AI + learning)
  private async runLocal(name: ActionName) { const p = this.plan(name); this.thought = p.reason; if (this.trace) { this.event("system", `scores: ${this.trace} -> ${name}`); this.trace = ""; } await this.execute(p); this.nextGap = rand(2500, 6000); }

  private score(a: ActionName): number {
    const { curiosity: c, social: s, boredom: b, valence: v, arousal: ar } = this;
    const company = this.personPresent(), tr = this.memory.long.traits;
        let u: number;
    switch (a) {
      case "wander": u = 0.7 * c + 0.2 * b - (company ? 0.35 : 0); break;
      case "look_around": u = 0.25 + 0.3 * c * (1 - ar) + 0.1 * b; break;
      case "dance": u = 0.3 * Math.max(0, v) + 0.7 * b + 0.15 * ar - 0.35 + (company ? 0.4 * Math.max(0, v) : 0) + 0.5 * (tr.playful - 0.5); break;
      case "rest": u = 0.1 + 0.6 * Math.max(0, ar - 0.5) + (v < -0.2 ? 0.3 : 0); break;
      case "call_out": u = company || this.userRecent(30000) || this.now() - this.lastSpokeAt < 25000 ? -Infinity : 1.1 * Math.max(0, s - 0.45); break;
      case "murmur": u = this.now() - this.lastSpokeAt < 15000 ? -Infinity : 0.1 + 0.2 * b + 0.15 * s; break;
      case "go_home": u = this.distHome() > ARENA * 0.9 ? 5 : -Infinity; break;
      case "play": u = this.freeToy() ? 0.6 * c + 0.5 * b + 0.4 * (tr.playful - 0.5) : -Infinity; break;
      case "watch": u = company ? 0.9 + 0.3 * s + 0.3 * (0.5 - tr.shy) - Math.min(0.6, this.presentSecs() / 120) : -Infinity; break;
    }
    if (!Number.isFinite(u)) return u;
    // hormones: dopamine = wanting, cortisol = stress/withdrawal, oxytocin = company, melatonin = sleep, acetylcholine = attention
    const ch = this.chem()?.nm;
    if (ch) {
      const dop = ch.dopamine - 0.1, cor = ch.cortisol - 0.1, oxy = ch.oxytocin - 0.1, mel = ch.melatonin - 0.1, ach = ch.acetylcholine - 0.15;
      if (a === "play") u += 0.8 * dop - 0.5 * cor;
      if (a === "wander") u += 0.6 * dop - 0.6 * cor;
      if (a === "dance") u += 0.6 * dop - 0.8 * cor;
      if (a === "look_around") u += 0.5 * ach;
      if (a === "watch" || a === "call_out") u += 0.6 * oxy;
      if (a === "rest") u += 0.8 * mel + 0.7 * cor;
    }
    // experience: what has worked before, overall (15%) and in this exact situation (25%)
    u += 0.15 * (this.memory.long.actionValue[a] ?? 0) + 0.25 * (this.memory.long.ctxValue[this.ctxKey(a)] ?? 0);
    if (this.recent[0] === a) u -= 0.45; else if (this.recent.includes(a)) u -= 0.15;
    return u;
  }

  private choose(): ActionName {
    const scored = ACTIONS.map((a) => ({ a, u: this.score(a) })).filter((x) => Number.isFinite(x.u));
    if (!scored.length) return "look_around";
    this.trace = [...scored].sort((x, y) => y.u - x.u).slice(0, 3).map((x) => `${x.a} ${x.u.toFixed(2)}`).join(" · ");
    const max = Math.max(...scored.map((x) => x.u));
    const w = scored.map((x) => Math.exp((x.u - max) / 0.18));
    let r = Math.random() * w.reduce((s, x) => s + x, 0);
    for (let i = 0; i < scored.length; i++) { r -= w[i]; if (r <= 0) return scored[i].a; }
    return scored[0].a;
  }

  /**
   * Explore on purpose: look at 8 headings, prefer the one leading to a place he hasn't been
   * (his memory of visited cells), avoid the arena edge, and don't turn more than needed.
   */
  private planWander(ms: number): { instr: Instr[]; effect: ActionName } {
    const p = this.body.getPose(), cells = new Set(this.memory.long.cells);
    let best = { rel: 0, score: -Infinity };
    for (const rel of [-135, -90, -45, 0, 45, 90, 135, 180]) {
      const h = ((p.headingDeg + rel) * Math.PI) / 180;
      const tx = p.x + Math.sin(h) * 10 * p.unit, tz = p.z + Math.cos(h) * 10 * p.unit;
      const key = `${Math.floor(tx / (p.unit * CELL))},${Math.floor(tz / (p.unit * CELL))}`;
      const edge = Math.hypot(tx, tz) / p.unit > ARENA * 0.85;
      const score = (this.opts.smartExplore === false ? 0 : cells.has(key) ? 0 : 1) - (edge ? 2 : 0) - (Math.abs(rel) / 180) * 0.3 + Math.random() * 0.5;
      if (score > best.score) best = { rel, score };
    }
    const instr: Instr[] = [];
    if (best.rel !== 0) instr.push(exec("FACE", p.headingDeg + best.rel), sleep(Math.abs(best.rel) / 420 * 1000 + 120));
    instr.push(exec("WALK_FORWARD"), sleep(ms), stopAll());
    return { instr, effect: "wander" };
  }

  private plan(a: ActionName): Plan {
    const name = this.memory.long.userName;
    const u = this.body.getPose().unit;
    switch (a) {
      case "wander": return { ...this.planWander(rand(2500, 6000)), reason: `Restless (curiosity ${pct(this.curiosity)}), so I'm going to explore.` };
      case "look_around": return { instr: [exec("EYE_SET", rand(30, 80)), sleep(800), exec("EYE_SET", rand(100, 150)), sleep(900), exec("EYE_CENTER")], reason: "Quietly checking my surroundings.", effect: a };
      case "dance": return { instr: [exec("DANCE"), sleep(rand(4000, 7000)), stopAll()], say: this.fresh(["I feel like dancing!", "Music in my head!", "I can't stand still!"]), reason: `Feeling ${this.mood()} and ${pct(this.boredom)} bored, so I'm dancing.`, effect: a };
      case "rest": return { instr: [stopAll(), exec("EYE_SET", 60), sleep(7000), exec("EYE_CENTER")], say: this.fresh(["Taking a quiet moment.", "Just resting for a bit.", "Ahh. Quiet."]), reason: `Feeling ${this.mood()}, so I'm taking a quiet moment.`, effect: a };
      case "call_out": return {
        instr: [exec("EYE_LEFT", 25), sleep(600), exec("EYE_RIGHT", 50), sleep(600), exec("EYE_CENTER")],
        say: name ? this.fresh([`${name}? Are you there?`, `Hey ${name}, I'm over here.`]) : this.fresh(["Hello? Is anyone there?", "I could use some company.", "It's so quiet in here."]),
        reason: `No company for a while (social need ${pct(this.social)}), so I'm calling out.`, effect: a };
      case "murmur": {
        const recall = Math.random() < 0.45 ? this.recallLine() : null;
        return { instr: [], say: recall ?? this.fresh(MURMURS[this.mood()] ?? MURMURS.calm), reason: recall ? "Remembering something from earlier." : `Thinking out loud, feeling ${this.mood()}.`, effect: a };
      }
      case "go_home": return { instr: [exec("GOTO", `0,0,${3 * u}`)], say: "I've wandered far. Heading back.", reason: "Too close to the arena edge, so I'm heading back to the middle.", effect: "wander" };
      case "watch": {
        const seen = this.opts.getSenses?.().seen ?? [];
        const lab = seen.find((x) => x.label === "person" || x.label === "someone")?.label ?? seen[0]?.label ?? "someone";
        return { instr: [sleep(rand(3000, 5000))], say: Math.random() < 0.2 ? pick(["I like having company.", "What are you up to?", "Still here?"]) : undefined,
          reason: `${lab === "person" || lab === "someone" ? "Someone is here" : "I can see a " + lab}, so I'm keeping my eyes on them.`, label: "watch", effect: a };
      }
      case "play": {
        const toy = this.freeToy();
        if (!toy) return this.plan("look_around");
        return { instr: [exec("GOTO", `${toy.x},${toy.z},${2.2 * u}`), exec("DANCE"), sleep(1500), stopAll()], say: Math.random() < 0.5 ? this.fresh(["Got it!", "Found you!", "Here I am!"]) : undefined, reason: `Bored and curious, so I'm going to play with ${toy.id}.`, effect: a };
      }
    }
  }

  /** Run a plan, then let consequences change drives and learn from how it felt. */
  private async execute(plan: Plan) {
    this.acting++;
    try {
      this.lastAction = plan.label ?? plan.effect ?? "idle";
      if (plan.effect) this.recent = [plan.effect, ...this.recent].slice(0, 3);
      this.event("action", plan.label ?? plan.reason);
      if (plan.say) { this.event("speech", plan.say); this.lastSpokeAt = this.now(); }
      const b = this.needs(), v0 = this.valence, ctx0 = this.ctxKey("");
      if (plan.effect === "rest") this.feel("sleep");
      await this.body.act(plan.instr, plan.say);
      if (plan.effect === "rest") this.feel("wake");
      if (plan.effect === "dance") this.feel("danced");
      let novel = false;
      if (plan.effect) {
        novel = this.applyEffects(plan.effect);
        const a = this.needs();
        const reward = (this.valence - v0) + 0.5 * ((b.c - a.c) + (b.b - a.b) + (b.s - a.s));
        const old = this.memory.long.actionValue[plan.effect] ?? 0;
        this.memory.long.actionValue[plan.effect] = clamp(old + 0.2 * (reward - old), -1, 1);
        const ck = ctx0 + plan.effect, oc = this.memory.long.ctxValue[ck] ?? 0;
        this.memory.long.ctxValue[ck] = clamp(oc + 0.3 * (reward - oc), -1, 1);
        this.memory.remember(plan.effect, plan.reason, reward, clamp(0.25 + Math.abs(reward) + (novel ? 0.4 : 0)));
      }
      this.journal.push(plan.reason.slice(0, 100)); if (this.journal.length > 8) this.journal.shift();
    } finally {
      this.acting--; this.lastDecisionAt = this.now(); this.emit();
    }
  }

  private applyEffects(a: ActionName): boolean {
    let novel = false;
    switch (a) {
      case "wander": {
        this.curiosity = clamp(this.curiosity - 0.2); this.boredom = clamp(this.boredom - 0.3);
        const p = this.body.getPose();
        const key = `${Math.floor(p.x / (p.unit * CELL))},${Math.floor(p.z / (p.unit * CELL))}`;
        const cells = this.memory.long.cells;
        if (!cells.includes(key)) {
          cells.push(key); if (cells.length > 400) cells.shift();
          novel = true; this.curiosity = clamp(this.curiosity - 0.2); this.valence = clamp(this.valence + 0.2, -1, 1); this.arousal = clamp(this.arousal + 0.15);
          this.memory.remember("discovered", `a new place (${key})`, 0.4, 0.8); this.event("memory", `discovered a new place (${key})`); this.feel("discovered");
        }
        this.checkToys(); break;
      }
      case "look_around": this.curiosity = clamp(this.curiosity - 0.08); this.boredom = clamp(this.boredom - 0.12); break;
      case "dance": this.boredom = clamp(this.boredom - 0.5); this.valence = clamp(this.valence + 0.15, -1, 1); this.arousal = clamp(this.arousal + 0.2); break;
      case "rest": this.arousal = clamp(this.arousal - 0.2); this.valence = clamp(this.valence + 0.05, -1, 1); break;
      case "play": this.checkToys(); break;
      case "watch": this.social = clamp(this.social - 0.15); this.boredom = clamp(this.boredom - 0.1); this.valence = clamp(this.valence + 0.05, -1, 1); break;
      case "call_out": this.social = clamp(this.social - 0.1); break;
      case "murmur": this.boredom = clamp(this.boredom - 0.1); this.social = clamp(this.social - 0.05); break;
      default: break;
    }
    return novel;
  }

  private checkToys() {
    for (const o of this.body.getWorld()) {
      if (o.kind !== "toy" || this.distTo(o.x, o.z) > 3.5 || (this.toyCooldown.get(o.id) ?? 0) > this.now()) continue;
      this.toyCooldown.set(o.id, this.now() + 45000);
      this.boredom = clamp(this.boredom - 0.4); this.curiosity = clamp(this.curiosity - 0.15);
      this.valence = clamp(this.valence + 0.25, -1, 1); this.arousal = clamp(this.arousal + 0.2);
      this.memory.remember("played", o.id, 0.5, 0.75); this.event("memory", `played with ${o.id}`); this.feel("played", o.id);
    }
  }

  // ----- helpers
  private brainReport(): CortexRequest["brain"] {
    const l = this.chem();
    if (!l) return undefined;
    return { emotion: l.emotion.toLowerCase(), intensity: Math.round(l.intensity * 100) / 100, because: l.because, instinct: l.instinct.toLowerCase(),
      hormones: Object.fromEntries(CHEMS.map((c) => [c.label, Math.round(l.nm[c.id] * 100)])) };
  }
  private chemSummary(): DialogueContext["chem"] {
    const nm = this.chem()?.nm;
    if (!nm) return undefined;
    return Object.fromEntries(CHEMS.map((c) => [c.label.toLowerCase(), { level: Math.round(nm[c.id] * 100), over: nm[c.id] - c.base, role: c.role }]));
  }
  private feel(kind: FeelKind, detail?: string) { this.opts.onFeel?.(kind, detail); }
  private chem(): LimbicState | undefined { return this.opts.getChem?.(); }
  private personPresent() { return this.opts.getSenses?.().personPresent === true; }
  private presentSecs() { return this.personSince ? (this.now() - this.personSince) / 1000 : 0; }
  private ctxKey(a: string) { return `${this.mood()}|${this.personPresent() ? "watched" : "alone"}|${a}`; }
  /** Habituation: each repeat of a stimulus counts for less, and it recovers while nothing happens. Returns the current strength. */
  private habituate(kind: string) { const f = this.habit[kind] ?? 1; this.habit[kind] = Math.max(0.25, f * 0.8); return f; }
  /** Say something short (cooldown-limited) without disturbing whatever the body is doing. */
  private react(text: string, force = false) {
    if (!force && this.now() - this.lastSpokeAt < 6000) return;
    this.lastSpokeAt = this.now(); this.event("speech", text); void this.body.act([], text);
  }
  private reflex(instr: Instr[]) { if (!this.body.isBusy() && this.acting === 0) void this.body.act(instr); }
  private async say(text: string) { this.event("speech", text); this.lastSpokeAt = this.now(); await this.body.act([], text); }
  private event(t: EventType, text: string) {
    if (t === "speech") { this.spoken.push(text); if (this.spoken.length > 12) this.spoken.shift(); this.convoPush("you", text); }
    this.opts.onEvent?.(t, text);
  }
  private needs() { return { c: this.curiosity, b: this.boredom, s: this.social }; }
  private userRecent(ms: number) { return this.now() - this.lastUserAt < ms; }
  private distTo(x: number, z: number) { const p = this.body.getPose(); return Math.hypot(x - p.x, z - p.z) / p.unit; }
  private distHome() { return this.distTo(0, 0); } // distance from the arena center
  private freeToy() {
    const toys = this.body.getWorld().filter((o) => o.kind === "toy" && (this.toyCooldown.get(o.id) ?? 0) <= this.now());
    return toys.sort((a, b) => this.distTo(a.x, a.z) - this.distTo(b.x, b.z))[0];
  }
  private resolveTarget(t: string): { x: number; z: number; stop: number } | null {
    const u = this.body.getPose().unit;
    if (t === "home" || t === "center") return { x: 0, z: 0, stop: 3 * u };
    const o = this.body.getWorld().find((w) => w.id === t);
    return o ? { x: o.x, z: o.z, stop: (o.r ?? 0) + 2.2 * u } : null;
  }
  private willing(dance: boolean): boolean {
    const fam = Math.min(1, this.memory.long.interactions / 20);
    const w = 0.55 + 0.35 * this.valence + 0.15 * fam + (dance ? 0.25 * this.boredom : 0.1 * this.curiosity) + (Math.random() - 0.5) * 0.2;
    return w > 0.45;
  }

  mood(): string {
    const lim = this.chem();
    if (lim?.asleep) return "sleepy";
    if (lim && lim.intensity > 0.45) {
      const m: Record<string, string> = { HAPPY: "happy", EXCITED: "excited", CURIOUS: "curious", SURPRISED: "startled", FEARFUL: "afraid", ANGRY: "angry", DISGUSTED: "disgusted", SAD: "sad", PAIN: "hurt" };
      if (m[lim.emotion]) return m[lim.emotion];
    }
    if (this.arousal > 0.55 && this.valence > 0.3) return "excited";
    if (this.arousal > 0.55 && this.valence < -0.1) return "startled";
    if (this.personPresent() && this.arousal > 0.3) return "attentive";
    if (this.social > 0.75 && this.valence < 0.1) return "lonely";
    if (this.boredom > 0.7) return "bored";
    if (this.curiosity > 0.65) return "curious";
    if (this.valence > 0.2) return "content";
    return "calm";
  }
  snapshot(): MindSnapshot {
    return {
      mode: this.mode, mood: this.mood(), valence: this.valence, arousal: this.arousal,
      curiosity: this.curiosity, social: this.social, boredom: this.boredom,
      thought: this.thought, lastAction: this.lastAction, interactions: this.memory.long.interactions,
      userName: this.memory.long.userName, favorite: this.memory.long.favorite,
    };
  }
  private emit() { this.opts.onUpdate?.(this.snapshot()); }
}
