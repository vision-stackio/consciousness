/**
 * Vision's mind. Two layers share one body of state:
 *
 *   drives + emotion + 3-tier memory   (always running, local, free)
 *   decision maker                     ALWAYS the local utility AI + learning,
 *                                      strongly driven by the emotional brain state
 *                                      (hormones, instinct, learned values).
 *
 *   "ai" mode                          LLM is used ONLY for natural language
 *                                      generation (what he says). It never
 *                                      chooses actions. The simulated brain
 *                                      remains the source of intelligence.
 *
 * Reflexes (startle, arena wall) never wait for anything.
 * Honest framing: this is a simulated mind. It is autonomous, not conscious.
 */
import { respond, learnFrom, refusal, pickFresh, SIGHT_REACTS } from "./dialogue.js";
import { CHEMS } from "./brainsim/chem.js";
const ACTIONS = ["wander", "look_around", "dance", "rest", "call_out", "murmur", "go_home", "play", "watch"];
export const ARENA = 40; // used only when ARENA_INFINITE is false
export const ARENA_INFINITE = true; // no wall, no purple ring, open world
const CELL = 8;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (v) => Math.round(v * 100) + "%";
const norm180 = (a) => (((a % 360) + 540) % 360) - 180;
const exec = (command, arg) => (arg === undefined ? { op: "EXEC", command } : { op: "EXEC", command, arg });
const sleep = (ms) => ({ op: "SLEEP", ms: Math.round(ms) });
const stopAll = () => exec("WALK_STOP");
const cleanSay = (s) => (typeof s === "string" ? s.replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, 240) : "");
/** Tiers: working (last 7), episodic (decays), long-term (consolidated, persisted). */
export class Memory {
    key;
    now;
    working = [];
    episodes = [];
    long = { interactions: 0, firstMetAt: 0, lastSeenAt: 0, actionValue: {}, cells: [], lessons: [], ctxValue: {}, seen: {}, traits: { playful: 0.5, shy: 0.5 }, facts: {} };
    constructor(key, now) {
        this.key = key;
        this.now = now;
        try {
            const raw = localStorage.getItem(key);
            if (raw) {
                const d = JSON.parse(raw);
                this.long = { ...this.long, ...d.long, traits: { ...this.long.traits, ...(d.long?.traits ?? {}) } };
                this.episodes = d.episodes ?? [];
            }
        }
        catch { /* storage unavailable */ }
    }
    remember(kind, detail, valence = 0, salience = 0.3) {
        this.working.push(`${kind}: ${detail}`);
        if (this.working.length > 7)
            this.working.shift();
        this.episodes.push({ t: this.now(), kind, detail, valence, salience });
        if (this.episodes.length > 200)
            this.episodes.shift();
    }
    consolidate() {
        for (const e of this.episodes) {
            e.salience *= 0.97;
            if (e.salience > 0.55 && !e.promoted) {
                e.promoted = true;
                this.long.lessons.push(`${e.kind}: ${e.detail}`);
                if (this.long.lessons.length > 20)
                    this.long.lessons.shift();
            }
        }
        this.episodes = this.episodes.filter((e) => e.salience > 0.08);
        const best = Object.entries(this.long.actionValue).sort((a, b) => b[1] - a[1])[0];
        this.long.favorite = best && best[1] > 0.05 ? best[0] : undefined;
        this.save();
    }
    save() {
        try {
            localStorage.setItem(this.key, JSON.stringify({ long: this.long, episodes: this.episodes.slice(-50) }));
        }
        catch { /* ignore */ }
    }
}
const MURMURS = {
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
export class Brain {
    body;
    opts;
    mode = "local";
    curiosity = 0.5;
    social = 0.4;
    boredom = 0.2;
    valence = 0.1;
    arousal = 0.3;
    thought = "Just woke up.";
    lastAction = "";
    recent = [];
    journal = [];
    notable = [];
    toyCooldown = new Map();
    lastUserAt = -1e12;
    lastDecisionAt;
    nextGap = 3000;
    lastSpokeAt = 0;
    habit = {}; // habituation: repeated stimuli matter less
    personSince = 0;
    lastPersonAt = -1e12;
    sightSaid = new Map(); // per-label comment cooldown
    spoken = []; // last things he said, to avoid repeating himself
    convo = [];
    lastTopic;
    tonicAt = {};
    trace = ""; // why the last local decision was made
    acting = 0;
    thinking = false;
    urgent = false;
    pendingHeard = null;
    ticks = 0;
    timer = null;
    now;
    scale;
    memory;
    /** Active goals (human-like hierarchical control). */
    goals = [];
    /** Model of the human (theory of mind). */
    userModel = {
        friendliness: 0.2, attention: 0.3, predictability: 0.5, lastAct: "", trust: 0.4,
        mood: 0.1, inferredGoal: "unknown", sharedKnowledge: [], recentActs: [], patience: 0.7,
    };
    /** Adaptive exploration temperature (meta-learning). */
    exploreTemp = 0.18;
    constructor(body, opts = {}) {
        this.body = body;
        this.opts = opts;
        this.now = opts.now ?? (() => Date.now());
        this.scale = opts.timeScale ?? 1;
        this.memory = new Memory(opts.storageKey ?? "vision.mind.v3", this.now);
        this.lastDecisionAt = this.now();
    }
    // ----- lifecycle
    start() {
        if (this.timer)
            return;
        const m = this.memory.long;
        const hello = m.userName ? `Welcome back, ${m.userName}.` : m.interactions > 0 ? "Good to see you again." : "Hello? I just woke up.";
        this.thought = m.interactions > 0 ? "I remember being here before." : "First time awake. Looking around.";
        this.event("system", this.thought);
        void this.say(hello);
        m.lastSeenAt = this.now();
        this.timer = setInterval(() => this.tick(), 1000);
    }
    stop() { if (this.timer)
        clearInterval(this.timer); this.timer = null; }
    setMode(m) { this.mode = m; this.event("system", `mind mode: ${m}`); this.emit(); }
    setTimeScale(n) { this.scale = Math.max(1, n); }
    /** Skip time forward (drives only, no decisions). */
    fastForward(seconds) { this.drift(seconds); this.event("system", `${seconds}s pass...`); this.emit(); }
    /** Add a note the AI cortex will see on its next think. */
    note(text) { this.notable.push(text); if (this.notable.length > 8)
        this.notable.shift(); this.event("percept", text); }
    // ----- perception
    notice() { this.lastUserAt = this.now(); this.arousal = clamp(this.arousal + 0.03); }
    /** Sandbox / sensor stimuli. Appraise immediately, react by reflex, let the cortex think about it. */
    stimulus(kind) {
        const f = ["motion", "loud_noise", "dark", "bright", "poke"].includes(kind) ? this.habituate(kind) : 1; // 1 = fresh, lower = used to it
        const v = (d) => (this.valence = clamp(this.valence + d * f, -1, 1));
        const a = (d) => (this.arousal = clamp(this.arousal + d * f));
        const tr = this.memory.long.traits;
        let text = "";
        switch (kind) {
            case "praise":
                tr.playful = clamp(tr.playful + 0.03);
                tr.shy = clamp(tr.shy - 0.02);
                v(0.35);
                a(0.2);
                this.social = clamp(this.social - 0.25);
                text = "someone praised me";
                this.lastUserAt = this.now();
                this.updateUserModel("praise");
                break;
            case "scold":
                tr.shy = clamp(tr.shy + 0.04);
                tr.playful = clamp(tr.playful - 0.02);
                v(-0.4);
                a(0.25);
                text = "someone scolded me";
                this.lastUserAt = this.now();
                this.updateUserModel("scold");
                break;
            case "loud_noise":
                tr.shy = clamp(tr.shy + 0.01);
                a(0.5);
                v(-0.2);
                text = "a loud noise nearby";
                this.reflex([stopAll(), exec("EYE_SET", 60), sleep(250), exec("EYE_SET", 120), sleep(250), exec("EYE_CENTER")]);
                break;
            case "gift":
                tr.playful = clamp(tr.playful + 0.02);
                v(0.3);
                this.boredom = clamp(this.boredom - 0.3);
                a(0.2);
                text = "someone dropped a new toy nearby";
                this.updateUserModel("gift");
                break;
            case "poke":
                a(0.3);
                v(0.05);
                text = "I was poked";
                this.lastUserAt = this.now();
                break;
            case "motion":
                a(0.2);
                this.social = clamp(this.social - 0.08 * f);
                text = "sudden movement in front of my camera";
                if (f > 0.6)
                    this.react(pick(["Whoa, what moved?", "Hey! I saw that."]));
                break;
            case "dark":
                v(-0.1);
                a(-0.1);
                text = "the lights went out";
                this.react("Hey, who turned off the lights?");
                break;
            case "bright":
                a(0.1);
                text = "the lights came on";
                this.react("Ooh, that got bright!");
                break;
            case "teleport":
                a(0.4);
                v(-0.15);
                text = "I got picked up and put down somewhere else";
                break;
            case "ignored":
                this.social = clamp(this.social + 0.4);
                this.boredom = clamp(this.boredom + 0.3);
                text = "nobody has talked to me for a long time";
                this.updateUserModel("ignore");
                break;
        }
        this.feel(kind);
        this.note(text);
        this.memory.remember("event", text, this.valence, 0.6 * f + 0.1);
        if (this.mode === "ai" && !["motion", "dark", "bright"].includes(kind))
            this.urgent = true;
        this.emit();
    }
    /**
     * Something appeared in (or left) his view: on the camera, or in the arena around him.
     * Local reaction first (so it works without any AI); the AI cortex also gets a note.
     */
    sight(ev) {
        const long = this.memory.long, now = this.now();
        const person = ev.label === "person" || ev.label === "someone";
        const where = ev.side === "center" ? "in front of me" : `on my ${ev.side}`;
        const art = (w) => (/^[aeiou]/i.test(w) ? "an " : "a ") + w;
        // ---- things in the arena around him (toys, scenery)
        if (ev.source === "arena") {
            if (ev.type !== "appeared")
                return;
            long.seen[ev.label] = (long.seen[ev.label] ?? 0) + 1;
            this.feel("arena_seen", ev.label);
            this.note(`I can see the ${ev.label} ${where}`);
            this.memory.remember("saw", `the ${ev.label}`, 0.05, 0.25);
            if (/toy/.test(ev.label))
                this.valence = clamp(this.valence + 0.05, -1, 1);
            if (now - (this.sightSaid.get(ev.label) ?? -1e12) > 60000 && !this.userRecent(4000) && Math.random() < 0.6) {
                this.sightSaid.set(ev.label, now);
                this.react(this.fresh([`There's the ${ev.label}.`, `Ooh, the ${ev.label}!`, `I can see the ${ev.label} ${where}.`]));
            }
            this.emit();
            return;
        }
        // ---- things on the camera
        if (ev.type === "appeared") {
            long.seen[ev.label] = (long.seen[ev.label] ?? 0) + 1;
            if (person) {
                const away = now - this.lastPersonAt;
                this.lastPersonAt = now;
                this.personSince = now;
                this.social = clamp(this.social - 0.5);
                this.valence = clamp(this.valence + 0.25, -1, 1);
                this.arousal = clamp(this.arousal + 0.25);
                long.traits.shy = clamp(long.traits.shy - 0.01);
                this.feel("person_arrived");
                this.note(`a person appeared ${where}${ev.near ? " (close)" : ""}`);
                this.memory.remember("saw", `a person ${where}`, 0.3, 0.6);
                if (away > 45000)
                    this.react(long.userName ? `Hey ${long.userName}, there you are!` : pick(["Oh, hello!", "Someone's here!", "Hi there!"]), true);
                if (this.mode === "ai")
                    this.urgent = true;
            }
            else {
                const r = SIGHT_REACTS[ev.label];
                const n = long.seen[ev.label];
                const desc = [ev.color, ev.label].filter(Boolean).join(" ");
                // big, near the middle, and not a person: someone is holding it up to the camera
                const shown = (ev.size ?? 0) > 0.07 && Math.abs((ev.cx ?? 0.5) - 0.5) < 0.3;
                this.curiosity = clamp(this.curiosity - (shown ? 0.25 : 0.15));
                this.valence = clamp(this.valence + (r?.v ?? 0.05) + (shown ? 0.05 : 0), -1, 1);
                this.arousal = clamp(this.arousal + (r?.a ?? 0.05) + (shown ? 0.15 : 0));
                this.feel(shown ? "object_shown" : "object_seen", ev.label);
                this.note(shown ? `someone is showing me ${art(desc)}` : `I see ${art(desc)} ${where}`);
                this.memory.remember("saw", art(desc), r?.v ?? 0.05, shown ? 0.9 : n === 1 ? 0.7 : 0.3);
                if (shown) {
                    this.lastUserAt = now - 4000; // someone is engaging with him: don't wander off mid-show
                    this.sightSaid.set(ev.label, now);
                    const line = r ? `Ooh! ${pick(r.say)}` : this.fresh([`Ooh! ${cap(art(desc))}. Let me look.`, `What's that? ${cap(art(desc))}?`, `You're showing me ${art(desc)}!`]);
                    this.react(n > 3 ? `${cap(art(desc))} again. You really like showing me that.` : line, true);
                    if (this.mode === "ai")
                        this.urgent = true;
                }
                else if (now - (this.sightSaid.get(ev.label) ?? -1e12) > 90000 && !this.userRecent(6000)) {
                    this.sightSaid.set(ev.label, now);
                    this.react(n > 2 ? `That ${ev.label} again.` : pick(r?.say ?? [`I see ${art(desc)}.`, `Oh, ${art(desc)}.`]));
                }
            }
        }
        else if (person) {
            this.personSince = 0;
            this.social = clamp(this.social + 0.12);
            this.feel("person_left");
            this.note("the person left my view");
            this.memory.remember("saw", "the person left", -0.1, 0.4);
            if ((ev.durationMs ?? 0) > 15000)
                this.react(pick(["Bye for now!", "Where did you go?"]));
        }
        this.emit();
    }
    /**
     * A finished sentence from the user. Returns an immediate reply when the local mind
     * handles it, or null (AI mode: the cortex answers). "Stop" is always obeyed.
     * Everything else, Vision decides: he may refuse, and he answers from his real state.
     */
    hear(text) {
        const t = text.toLowerCase();
        this.lastUserAt = this.now();
        const long = this.memory.long;
        long.interactions++;
        long.lastSeenAt = this.now();
        if (!long.firstMetAt)
            long.firstMetAt = this.now();
        const good = /\b(good|great|nice|love|awesome|cool|thanks|thank|friend|well done)\b/.test(t) ? 1 : 0;
        const bad = /\b(bad|stupid|hate|ugly|useless|shut up)\b/.test(t) ? 1 : 0;
        this.social = clamp(this.social - 0.5);
        this.boredom = clamp(this.boredom - 0.3);
        this.arousal = clamp(this.arousal + 0.25);
        this.valence = clamp(this.valence + 0.1 + 0.25 * good - 0.35 * bad, -1, 1);
        this.updateUserModel(good ? "praise" : bad ? "scold" : "talk");
        this.event("percept", `heard: "${text.slice(0, 80)}"`);
        this.memory.remember("heard", text.slice(0, 60), this.valence, 0.5 + 0.3 * (good + bad));
        this.convoPush("user", text);
        this.feel("heard", text);
        // remember what the user tells him, in every mode (the AI cortex sees these facts too)
        const learned = learnFrom(text);
        if (learned.name) {
            long.userName = learned.name;
            this.memory.remember("learned", `you are called ${learned.name}`, 0.4, 0.9);
        }
        for (const [k, v] of learned.facts) {
            long.facts[k] = k === "likes" && long.facts.likes && !long.facts.likes.includes(v) ? `${long.facts.likes}, ${v}`.slice(-80) : v;
            this.memory.remember("learned", `your ${k} is ${v}`, 0.3, 0.8);
        }
        if (learned.name || learned.facts.length)
            this.memory.save();
        if (/\b(stop|halt|freeze)\b/.test(t))
            return this.say_("Okay, stopping.", [stopAll()]);
        // Local dialogue system is always the first authority for commands and
        // factual replies. This keeps the simulated brain in control.
        const ctx = this.dialogueCtx();
        const res = respond(text, ctx);
        if (res) {
            this.lastTopic = res.topic;
            if (res.effects) {
                this.valence = clamp(this.valence + (res.effects.valence ?? 0), -1, 1);
                this.arousal = clamp(this.arousal + (res.effects.arousal ?? 0));
                this.social = clamp(this.social + (res.effects.social ?? 0));
            }
            if (res.command)
                return this.runCommand(res.command, res.reply, ctx);
            // Pure conversational reply — in AI mode we can optionally let the LLM
            // rephrase it more naturally, otherwise use the local line.
            if (this.mode === "ai" && this.opts.think && !this.thinking) {
                void this.think(text); // will only generate speech
                return null;
            }
            return this.say_(res.reply, []);
        }
        // Nothing the local system recognised — in AI mode ask the LLM for speech only
        if (this.mode === "ai") {
            if (this.thinking)
                this.pendingHeard = text;
            else
                void this.think(text);
            return null;
        }
        return null;
    }
    /** He decides whether he feels like doing what was asked. */
    runCommand(cmd, reply, ctx) {
        const effortful = cmd === "dance" || cmd === "walk" || cmd === "play";
        if (effortful && !this.willing(cmd === "dance")) {
            this.memory.remember("refused", cmd, -0.1, 0.5);
            this.feel("refused");
            return this.say_(refusal(ctx), []);
        }
        this.memory.remember("obeyed", cmd, 0.1, 0.3);
        this.feel("obeyed");
        const turn = (c, n = 1) => Array.from({ length: n }, () => exec(c, 600));
        switch (cmd) {
            case "dance": return this.say_(reply, [exec("DANCE"), sleep(6000), stopAll()]);
            case "walk": return this.say_(reply, [exec("WALK_FORWARD"), sleep(4000), stopAll()]);
            case "turn_left": return this.say_(reply, turn("TURN_LEFT"));
            case "turn_right": return this.say_(reply, turn("TURN_RIGHT"));
            case "turn_around": return this.say_(reply, turn("TURN_RIGHT", 2));
            case "rest": return this.say_(reply, [stopAll(), exec("EYE_SET", 60), sleep(5000), exec("EYE_CENTER")]);
            case "look": return this.say_(reply, [exec("EYE_SET", 40), sleep(800), exec("EYE_SET", 140), sleep(800), exec("EYE_CENTER")]);
            case "look_at_me":
            case "come": return this.say_(reply, [exec("EYE_CENTER")]);
            case "play": {
                const toy = this.freeToy();
                if (!toy)
                    return this.say_("I've played with all the toys for now. Drop me a new one?", []);
                const u = this.body.getPose().unit;
                return this.say_(reply, [exec("GOTO", `${toy.x},${toy.z},${2.2 * u}`), exec("DANCE"), sleep(1500), stopAll()]);
            }
        }
    }
    say_(reply, instructions) { this.event("speech", reply); return { reply, instructions }; }
    convoPush(who, text) { this.convo.push({ who, text: text.slice(0, 160) }); if (this.convo.length > 8)
        this.convo.shift(); }
    dialogueCtx() {
        const m = this.memory.long, sn = this.opts.getSenses?.();
        return {
            mood: this.mood(), valence: this.valence, arousal: this.arousal, curiosity: this.curiosity, social: this.social, boredom: this.boredom,
            userName: m.userName, facts: m.facts, interactions: m.interactions, thought: this.thought, lastAction: this.lastAction, favorite: m.favorite,
            traits: m.traits, chem: this.chemSummary(), camera: sn?.camera ?? false, seen: sn?.seen ?? [], personPresent: sn?.personPresent ?? false, visionMode: sn?.visionMode,
            lastSaid: this.spoken, lastTopic: this.lastTopic, date: new Date(this.now()),
        };
    }
    /** A line he hasn't said recently. */
    fresh(lines) { return pickFresh(lines, this.spoken, Math.random); }
    /** Something from his own past, said out loud. Gives him an inner life. */
    recallLine() {
        const now = this.now(), name = this.memory.long.userName;
        const eps = this.memory.episodes.filter((e) => e.salience > 0.45 && now - e.t > 20000 && ["played", "discovered", "saw", "refused", "learned", "event"].includes(e.kind));
        if (!eps.length)
            return null;
        const e = eps[Math.floor(Math.random() * eps.length)];
        const noun = e.detail.replace(/^an? /, "");
        switch (e.kind) {
            case "played": {
                const toy = e.detail.replace(/^toy_(\w+)$/, "the $1 toy");
                return this.fresh([`I had fun with ${toy} earlier.`, `I keep thinking about ${toy}.`]);
            }
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
        if (++this.ticks % 15 === 0)
            this.memory.consolidate();
        this.emit();
        if (this.mode === "off" || this.acting > 0 || this.thinking || this.body.isBusy())
            return;
        // brainstem: arena safety (disabled when ARENA_INFINITE)
        if (!ARENA_INFINITE && this.distHome() > ARENA * 0.9) {
            void this.runLocal("go_home");
            return;
        }
        const gap = (this.personPresent() ? Math.min(this.nextGap, 2500) : this.nextGap) / this.scale; // more responsive with company
        if (!(this.urgent || (!this.userRecent(8000) && this.now() - this.lastDecisionAt > gap)))
            return;
        this.urgent = false;
        // PRIMARY INTELLIGENCE is always the local mind, driven by brain state.
        // LLM (if present) is only asked to generate natural speech that fits
        // the already-chosen action. It never selects what to do.
        const action = this.choose();
        if (this.mode === "ai" && this.opts.think) {
            void this.runLocalWithOptionalSpeech(action);
        }
        else {
            void this.runLocal(action);
        }
    }
    drift(dt) {
        // Base curiosity rise + extra from neural surprise (large |RPE| → world was
        // unpredictable → the brain wants to explore more).
        const ls = this.opts.getLearning?.();
        const surpriseBoost = ls && typeof ls.rpe === "number" ? Math.min(0.35, Math.abs(ls.rpe) * 0.5) : 0;
        this.curiosity = clamp(this.curiosity + (0.008 + 0.02 * surpriseBoost) * dt);
        this.social = clamp(this.social + 0.005 * dt * (this.userRecent(30000) ? 0.2 : 1));
        this.boredom = clamp(this.boredom + 0.006 * dt);
        for (const k of Object.keys(this.habit))
            this.habit[k] = Math.min(1, this.habit[k] + 0.01 * dt);
        const ch = this.chem()?.nm;
        // hormones move his emotional baseline: serotonin/oxytocin/dopamine/endorphin lift it, cortisol sinks it
        const chemV = ch ? 0.35 * (ch.serotonin - 0.4) + 0.3 * (ch.oxytocin - 0.1) + 0.25 * (ch.endorphin - 0.1) + 0.3 * (ch.dopamine - 0.1) - 0.5 * (ch.cortisol - 0.1) : 0;
        const chemA = ch ? 0.4 * (ch.noradrenaline - 0.1) + 0.3 * (ch.adrenaline - 0.05) - 0.3 * (ch.melatonin - 0.1) : 0;
        const base = 0.15 - 0.4 * Math.max(0, this.social - 0.6) - 0.3 * Math.max(0, this.boredom - 0.7) + chemV;
        const k = Math.min(1, 0.03 * dt);
        this.valence = clamp(this.valence + (base - this.valence) * k, -1, 1);
        this.arousal = clamp(this.arousal + (0.25 + chemA - this.arousal) * Math.min(1, 0.08 * dt));
        // --- Goal formation & decay (hierarchical control) ---
        this.updateGoals(dt);
        // --- Adaptive exploration temperature (meta-learning) ---
        // High recent surprise or low trust → explore more; stable success → exploit
        const targetTemp = 0.12 + 0.12 * surpriseBoost + 0.08 * (1 - this.userModel.predictability) + 0.06 * (1 - this.userModel.trust);
        this.exploreTemp += (targetTemp - this.exploreTemp) * Math.min(1, 0.04 * dt);
        // strong needs are felt by the emotional brain too (rate-limited)
        const t = this.now();
        const tonic = (kind, on) => { if (on && t - (this.tonicAt[kind] ?? -1e12) > 6000) {
            this.tonicAt[kind] = t;
            this.feel(kind);
        } };
        tonic("lonely", this.social > 0.78 && !this.personPresent());
        tonic("bored", this.boredom > 0.78);
        tonic("wondering", this.curiosity > 0.72);
        tonic("company", this.personPresent()); // having someone around is quietly rewarding (oxytocin)
    }
    // ----- AI cortex (LANGUAGE ONLY)
    // The LLM never chooses actions. It may only produce natural speech.
    // When the user speaks we still let the local dialogue system handle
    // commands; the LLM can optionally enrich the reply text.
    async think(heard) {
        // Action is always chosen locally
        const action = this.choose();
        if (!this.opts.think) {
            this.event("system", "no cortex configured, using local mind");
            return this.runLocal(action);
        }
        this.thinking = true;
        this.event("system", heard ? "forming a reply..." : "choosing words...");
        try {
            const req = this.buildRequest(heard);
            req.forcedAction = action;
            req.languageOnly = true;
            const d = await this.opts.think(req);
            // Ignore any action the LLM might still try to return; only take speech
            const plan = this.plan(action);
            const line = cleanSay(d.say);
            if (line)
                plan.say = line;
            this.thought = plan.reason;
            await this.execute(plan);
        }
        catch (e) {
            this.event("system", `cortex unavailable (${e.message}); using local mind`);
            await this.runLocal(action);
        }
        finally {
            this.thinking = false;
            this.lastDecisionAt = this.now();
            const h = this.pendingHeard;
            this.pendingHeard = null;
            if (h)
                void this.think(h);
        }
    }
    buildRequest(heard) {
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
    async runDecision(d) {
        this.thought = String(d.thought ?? "").slice(0, 240) || "…";
        this.event("thought", this.thought);
        if (d.emotion) {
            this.valence = clamp(this.valence + clamp(Number(d.emotion.valence ?? 0), -0.3, 0.3), -1, 1);
            this.arousal = clamp(this.arousal + clamp(Number(d.emotion.arousal ?? 0), -0.3, 0.3));
        }
        if (d.remember)
            this.memory.remember("note", cleanSay(d.remember).slice(0, 120), 0.2, 0.7);
        this.nextGap = clamp(Number(d.next_think_in_s ?? 8), 3, 30) * 1000;
        const plan = this.planFromDecision(d);
        await this.execute(plan);
    }
    planFromDecision(d) {
        const a = d.action ?? { type: "idle" };
        const say = cleanSay(d.say) || undefined;
        const dur = (lo, hi, def) => clamp(Number(a.duration_ms ?? def), lo, hi);
        const p = this.body.getPose();
        const label = a.type + (a.target ? ` ${a.target}` : "");
        switch (a.type) {
            case "look": return { instr: [exec("EYE_SET", clamp(Number(a.angle ?? 90), 0, 180)), sleep(1000), exec("EYE_CENTER")], say, reason: label, label, effect: "look_around" };
            case "turn": return { instr: [exec("FACE", p.headingDeg + clamp(Number(a.angle ?? 90), -180, 180)), sleep(700)], say, reason: label, label, effect: null };
            case "wander": return { ...this.planWander(dur(1500, 8000, 4000)), say, reason: label, label };
            case "go_to": {
                const t = this.resolveTarget(String(a.target ?? ""));
                if (!t) {
                    this.event("system", `unknown target "${a.target}", ignoring`);
                    return { instr: [], say, reason: "idle", label: "idle", effect: null };
                }
                return { instr: [exec("GOTO", `${t.x},${t.z},${t.stop}`)], say, reason: label, label, effect: "wander" };
            }
            case "dance": return { instr: [exec("DANCE"), sleep(dur(3000, 9000, 5000)), stopAll()], say, reason: label, label, effect: "dance" };
            case "rest": return { instr: [stopAll(), exec("EYE_SET", 60), sleep(dur(3000, 10000, 6000)), exec("EYE_CENTER")], say, reason: label, label, effect: "rest" };
            case "stop": return { instr: [stopAll()], say, reason: label, label, effect: null };
            default: return { instr: [], say, reason: "idle", label: "idle", effect: say ? "murmur" : null };
        }
    }
    // ----- local decision maker (utility AI + learning) — PRIMARY INTELLIGENCE
    async runLocal(name) {
        const p = this.plan(name);
        this.thought = p.reason;
        if (this.trace) {
            this.event("system", `scores: ${this.trace} -> ${name}`);
            this.trace = "";
        }
        await this.execute(p);
        this.nextGap = rand(2500, 6000);
    }
    /**
     * Same as runLocal, but if an LLM is available ask it only for a natural
     * speech line that fits the already-chosen action and current brain state.
     * The LLM never selects the action.
     */
    async runLocalWithOptionalSpeech(name) {
        const p = this.plan(name);
        this.thought = p.reason;
        if (this.trace) {
            this.event("system", `scores: ${this.trace} -> ${name}`);
            this.trace = "";
        }
        // Only ask the LLM for language when the action naturally involves speech
        // or when we want a richer murmur. Otherwise keep the local line.
        const wantsSpeech = name === "call_out" || name === "murmur" || name === "watch" || Math.random() < 0.25;
        if (wantsSpeech && this.opts.think) {
            try {
                this.thinking = true;
                const req = this.buildRequest();
                // Tell the cortex the action is already decided; it may only supply "say"
                req.forcedAction = name;
                req.languageOnly = true;
                const d = await this.opts.think(req);
                const line = cleanSay(d.say);
                if (line)
                    p.say = line;
            }
            catch {
                // fall through with the local reason / no speech
            }
            finally {
                this.thinking = false;
            }
        }
        await this.execute(p);
        this.nextGap = rand(2500, 6000);
        this.lastDecisionAt = this.now();
    }
    // ----- Goals & theory-of-mind ---------------------------------------------
    adoptGoal(kind, priority, durationMs, detail) {
        // Replace any existing goal of the same kind
        this.goals = this.goals.filter((g) => g.kind !== kind);
        this.goals.push({ id: `${kind}-${this.now()}`, kind, priority: clamp(priority), until: this.now() + durationMs, detail });
        // Keep only top 3 by priority
        this.goals.sort((a, b) => b.priority - a.priority);
        if (this.goals.length > 3)
            this.goals.length = 3;
    }
    updateGoals(_dt) {
        const t = this.now();
        this.goals = this.goals.filter((g) => g.until > t);
        // Form new goals from strong drives / brain state
        if (this.curiosity > 0.75 && !this.goals.some((g) => g.kind === "explore")) {
            this.adoptGoal("explore", 0.55 + 0.3 * this.curiosity, 25000);
        }
        if (this.social > 0.7 && !this.personPresent() && !this.goals.some((g) => g.kind === "social")) {
            this.adoptGoal("social", 0.5 + 0.35 * this.social, 20000);
        }
        if (this.boredom > 0.72 && this.freeToy() && !this.goals.some((g) => g.kind === "play")) {
            this.adoptGoal("play", 0.5 + 0.3 * this.boredom, 18000);
        }
        const lim = this.chem();
        if (lim && (lim.nm.cortisol > 0.45 || lim.emotion === "FEARFUL" || lim.emotion === "SAD")) {
            if (!this.goals.some((g) => g.kind === "rest" || g.kind === "avoid")) {
                this.adoptGoal(lim.emotion === "FEARFUL" ? "avoid" : "rest", 0.6, 15000);
            }
        }
        if (lim?.instinct === "INVESTIGATE" && (lim.instinctConfidence ?? 0) > 0.55) {
            this.adoptGoal("investigate", 0.5 + 0.3 * (lim.instinctConfidence ?? 0.5), 12000);
        }
    }
    updateUserModel(kind) {
        const um = this.userModel;
        const t = this.now();
        um.recentActs.push({ act: kind, at: t });
        if (um.recentActs.length > 24)
            um.recentActs = um.recentActs.slice(-24);
        switch (kind) {
            case "praise":
                um.friendliness = clamp(um.friendliness + 0.12, -1, 1);
                um.trust = clamp(um.trust + 0.08);
                um.attention = clamp(um.attention + 0.15);
                um.mood = clamp(um.mood + 0.15, -1, 1);
                um.inferredGoal = "chat";
                um.patience = clamp(um.patience + 0.05);
                break;
            case "scold":
                um.friendliness = clamp(um.friendliness - 0.18, -1, 1);
                um.trust = clamp(um.trust - 0.1);
                um.attention = clamp(um.attention + 0.1);
                um.mood = clamp(um.mood - 0.2, -1, 1);
                um.inferredGoal = "alone";
                um.patience = clamp(um.patience - 0.08);
                break;
            case "talk":
                um.attention = clamp(um.attention + 0.2);
                um.predictability = clamp(um.predictability + 0.03);
                um.mood = clamp(um.mood + 0.04, -1, 1);
                um.inferredGoal = "chat";
                um.patience = clamp(um.patience + 0.02);
                break;
            case "ignore":
                um.attention = clamp(um.attention - 0.08);
                um.friendliness = clamp(um.friendliness - 0.03, -1, 1);
                um.inferredGoal = "alone";
                um.patience = clamp(um.patience - 0.06);
                break;
            case "gift":
                um.friendliness = clamp(um.friendliness + 0.1, -1, 1);
                um.trust = clamp(um.trust + 0.06);
                um.mood = clamp(um.mood + 0.12, -1, 1);
                um.inferredGoal = "play";
                break;
            case "presence":
                um.attention = clamp(um.attention + 0.04);
                if (um.inferredGoal === "alone")
                    um.inferredGoal = "unknown";
                break;
        }
        // Predictability from consistency of recent acts
        if (um.recentActs.length >= 4) {
            const last = um.recentActs.slice(-6).map((a) => a.act);
            const unique = new Set(last).size;
            um.predictability = clamp(0.2 + 0.15 * (6 - unique), 0, 1);
        }
        um.lastAct = kind;
    }
    /** Record a mutually known fact (e.g. person's name) for ToM / dialogue. */
    noteSharedKnowledge(fact) {
        const f = fact.trim().slice(0, 80);
        if (!f)
            return;
        if (!this.userModel.sharedKnowledge.includes(f)) {
            this.userModel.sharedKnowledge.push(f);
            if (this.userModel.sharedKnowledge.length > 20) {
                this.userModel.sharedKnowledge = this.userModel.sharedKnowledge.slice(-20);
            }
        }
    }
    /** Snapshot of the human model (for UI / prompts). */
    tomState() {
        const um = this.userModel;
        return {
            friendliness: um.friendliness,
            attention: um.attention,
            trust: um.trust,
            mood: um.mood,
            goal: um.inferredGoal,
            patience: um.patience,
            predictability: um.predictability,
            knows: [...um.sharedKnowledge],
        };
    }
    score(a) {
        const { curiosity: c, social: s, boredom: b, valence: v, arousal: ar } = this;
        const company = this.personPresent(), tr = this.memory.long.traits;
        let u;
        switch (a) {
            case "wander":
                u = 0.7 * c + 0.2 * b - (company ? 0.35 : 0);
                break;
            case "look_around":
                u = 0.25 + 0.3 * c * (1 - ar) + 0.1 * b;
                break;
            case "dance":
                u = 0.3 * Math.max(0, v) + 0.7 * b + 0.15 * ar - 0.35 + (company ? 0.4 * Math.max(0, v) : 0) + 0.5 * (tr.playful - 0.5);
                break;
            case "rest":
                u = 0.1 + 0.6 * Math.max(0, ar - 0.5) + (v < -0.2 ? 0.3 : 0);
                break;
            case "call_out":
                u = company || this.userRecent(30000) || this.now() - this.lastSpokeAt < 25000 ? -Infinity : 1.1 * Math.max(0, s - 0.45);
                break;
            case "murmur":
                u = this.now() - this.lastSpokeAt < 15000 ? -Infinity : 0.1 + 0.2 * b + 0.15 * s;
                break;
            case "go_home":
                u = (!ARENA_INFINITE && this.distHome() > ARENA * 0.9) ? 5 : -Infinity;
                break;
            case "play":
                u = this.freeToy() ? 0.6 * c + 0.5 * b + 0.4 * (tr.playful - 0.5) : -Infinity;
                break;
            case "watch":
                u = company ? 0.9 + 0.3 * s + 0.3 * (0.5 - tr.shy) - Math.min(0.6, this.presentSecs() / 120) : -Infinity;
                break;
        }
        if (!Number.isFinite(u))
            return u;
        // hormones: dopamine = wanting, cortisol = stress/withdrawal, oxytocin = company, melatonin = sleep, acetylcholine = attention
        const lim = this.chem();
        const ch = lim?.nm;
        if (ch) {
            const dop = ch.dopamine - 0.1, cor = ch.cortisol - 0.1, oxy = ch.oxytocin - 0.1, mel = ch.melatonin - 0.1, ach = ch.acetylcholine - 0.15;
            if (a === "play")
                u += 0.8 * dop - 0.5 * cor;
            if (a === "wander")
                u += 0.6 * dop - 0.6 * cor;
            if (a === "dance")
                u += 0.6 * dop - 0.8 * cor;
            if (a === "look_around")
                u += 0.5 * ach;
            if (a === "watch" || a === "call_out")
                u += 0.6 * oxy;
            if (a === "rest")
                u += 0.8 * mel + 0.7 * cor;
        }
        // Active goals bias the policy (hierarchical control)
        for (const g of this.goals) {
            const w = 0.45 * g.priority;
            if (g.kind === "explore" && (a === "wander" || a === "look_around"))
                u += w;
            if (g.kind === "social" && (a === "call_out" || a === "watch" || a === "murmur"))
                u += w;
            if (g.kind === "play" && (a === "play" || a === "dance"))
                u += w;
            if (g.kind === "rest" && a === "rest")
                u += w;
            if (g.kind === "avoid" && (a === "rest" || a === "look_around"))
                u += w;
            if (g.kind === "investigate" && (a === "look_around" || a === "wander" || a === "play"))
                u += w;
        }
        // Theory-of-mind: inferred goals, mood, trust, patience modulate social policy
        const um = this.userModel;
        if (a === "watch" || a === "call_out") {
            u += 0.35 * um.friendliness + 0.25 * um.attention + 0.2 * (um.trust - 0.4);
            if (um.inferredGoal === "chat")
                u += 0.25;
            if (um.inferredGoal === "alone")
                u -= 0.35;
            if (um.patience < 0.35)
                u -= 0.2;
        }
        if (a === "dance" || a === "play") {
            u += 0.2 * um.friendliness - 0.25 * Math.max(0, -um.friendliness);
            if (um.inferredGoal === "play")
                u += 0.35;
            if (um.mood < -0.2)
                u -= 0.25;
        }
        if (a === "rest" && (um.inferredGoal === "alone" || um.patience < 0.3))
            u += 0.2;
        if (a === "murmur" && um.sharedKnowledge.length > 0 && um.attention > 0.4)
            u += 0.12;
        // Strong coupling to the emotional brain's current instinct
        // (this is how the neural decision layer steers high-level behaviour)
        if (lim?.instinct) {
            const inst = lim.instinct.toUpperCase();
            const boost = 0.55 * (lim.instinctConfidence ?? 0.5);
            if (inst === "APPROACH" || inst === "GREET") {
                if (a === "watch" || a === "call_out" || a === "play")
                    u += boost;
            }
            else if (inst === "INVESTIGATE") {
                if (a === "look_around" || a === "wander" || a === "play")
                    u += boost;
            }
            else if (inst === "FLEE" || inst === "FREEZE" || inst === "WITHDRAW") {
                if (a === "rest" || a === "look_around")
                    u += boost;
                if (a === "dance" || a === "play" || a === "call_out")
                    u -= boost;
            }
            else if (inst === "CONFRONT") {
                if (a === "dance" || a === "call_out")
                    u += boost * 0.6;
            }
        }
        // experience: what has worked before, overall (15%) and in this exact situation (25%)
        u += 0.15 * (this.memory.long.actionValue[a] ?? 0) + 0.25 * (this.memory.long.ctxValue[this.ctxKey(a)] ?? 0);
        if (this.recent[0] === a)
            u -= 0.45;
        else if (this.recent.includes(a))
            u -= 0.15;
        return u;
    }
    choose() {
        const scored = ACTIONS.map((a) => ({ a, u: this.score(a) })).filter((x) => Number.isFinite(x.u));
        if (!scored.length)
            return "look_around";
        this.trace = [...scored].sort((x, y) => y.u - x.u).slice(0, 3).map((x) => `${x.a} ${x.u.toFixed(2)}`).join(" · ");
        const max = Math.max(...scored.map((x) => x.u));
        // Adaptive temperature: higher → more exploration (human-like uncertainty-driven behaviour)
        const temp = Math.max(0.08, Math.min(0.35, this.exploreTemp));
        const w = scored.map((x) => Math.exp((x.u - max) / temp));
        let r = Math.random() * w.reduce((s, x) => s + x, 0);
        for (let i = 0; i < scored.length; i++) {
            r -= w[i];
            if (r <= 0)
                return scored[i].a;
        }
        return scored[0].a;
    }
    /**
     * Explore on purpose: look at 8 headings, prefer the one leading to a place he hasn't been
     * (his memory of visited cells), avoid the arena edge, and don't turn more than needed.
     */
    planWander(ms) {
        const p = this.body.getPose(), cells = new Set(this.memory.long.cells);
        let best = { rel: 0, score: -Infinity };
        for (const rel of [-135, -90, -45, 0, 45, 90, 135, 180]) {
            const h = ((p.headingDeg + rel) * Math.PI) / 180;
            const tx = p.x + Math.sin(h) * 10 * p.unit, tz = p.z + Math.cos(h) * 10 * p.unit;
            const key = `${Math.floor(tx / (p.unit * CELL))},${Math.floor(tz / (p.unit * CELL))}`;
            const edge = !ARENA_INFINITE && Math.hypot(tx, tz) / p.unit > ARENA * 0.85;
            const score = (this.opts.smartExplore === false ? 0 : cells.has(key) ? 0 : 1) - (edge ? 2 : 0) - (Math.abs(rel) / 180) * 0.3 + Math.random() * 0.5;
            if (score > best.score)
                best = { rel, score };
        }
        const instr = [];
        if (best.rel !== 0)
            instr.push(exec("FACE", p.headingDeg + best.rel), sleep(Math.abs(best.rel) / 420 * 1000 + 120));
        instr.push(exec("WALK_FORWARD"), sleep(ms), stopAll());
        return { instr, effect: "wander" };
    }
    plan(a) {
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
                reason: `No company for a while (social need ${pct(this.social)}), so I'm calling out.`, effect: a
            };
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
                if (!toy)
                    return this.plan("look_around");
                return { instr: [exec("GOTO", `${toy.x},${toy.z},${2.2 * u}`), exec("DANCE"), sleep(1500), stopAll()], say: Math.random() < 0.5 ? this.fresh(["Got it!", "Found you!", "Here I am!"]) : undefined, reason: `Bored and curious, so I'm going to play with ${toy.id}.`, effect: a };
            }
        }
    }
    /** Run a plan, then let consequences change drives and learn from how it felt. */
    async execute(plan) {
        this.acting++;
        try {
            this.lastAction = plan.label ?? plan.effect ?? "idle";
            if (plan.effect)
                this.recent = [plan.effect, ...this.recent].slice(0, 3);
            this.event("action", plan.label ?? plan.reason);
            if (plan.say) {
                this.event("speech", plan.say);
                this.lastSpokeAt = this.now();
            }
            const b = this.needs(), v0 = this.valence, ctx0 = this.ctxKey("");
            if (plan.effect === "rest")
                this.feel("sleep");
            await this.body.act(plan.instr, plan.say);
            if (plan.effect === "rest")
                this.feel("wake");
            if (plan.effect === "dance")
                this.feel("danced");
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
                // Teach the neural layer with the same behavioural outcome so both
                // levels of intelligence stay aligned.
                this.opts.onOutcome?.(reward);
            }
            this.journal.push(plan.reason.slice(0, 100));
            if (this.journal.length > 8)
                this.journal.shift();
        }
        finally {
            this.acting--;
            this.lastDecisionAt = this.now();
            this.emit();
        }
    }
    applyEffects(a) {
        let novel = false;
        switch (a) {
            case "wander": {
                this.curiosity = clamp(this.curiosity - 0.2);
                this.boredom = clamp(this.boredom - 0.3);
                const p = this.body.getPose();
                const key = `${Math.floor(p.x / (p.unit * CELL))},${Math.floor(p.z / (p.unit * CELL))}`;
                const cells = this.memory.long.cells;
                if (!cells.includes(key)) {
                    cells.push(key);
                    if (cells.length > 400)
                        cells.shift();
                    novel = true;
                    this.curiosity = clamp(this.curiosity - 0.2);
                    this.valence = clamp(this.valence + 0.2, -1, 1);
                    this.arousal = clamp(this.arousal + 0.15);
                    this.memory.remember("discovered", `a new place (${key})`, 0.4, 0.8);
                    this.event("memory", `discovered a new place (${key})`);
                    this.feel("discovered");
                }
                this.checkToys();
                break;
            }
            case "look_around":
                this.curiosity = clamp(this.curiosity - 0.08);
                this.boredom = clamp(this.boredom - 0.12);
                break;
            case "dance":
                this.boredom = clamp(this.boredom - 0.5);
                this.valence = clamp(this.valence + 0.15, -1, 1);
                this.arousal = clamp(this.arousal + 0.2);
                break;
            case "rest":
                this.arousal = clamp(this.arousal - 0.2);
                this.valence = clamp(this.valence + 0.05, -1, 1);
                break;
            case "play":
                this.checkToys();
                break;
            case "watch":
                this.social = clamp(this.social - 0.15);
                this.boredom = clamp(this.boredom - 0.1);
                this.valence = clamp(this.valence + 0.05, -1, 1);
                break;
            case "call_out":
                this.social = clamp(this.social - 0.1);
                break;
            case "murmur":
                this.boredom = clamp(this.boredom - 0.1);
                this.social = clamp(this.social - 0.05);
                break;
            default: break;
        }
        return novel;
    }
    checkToys() {
        for (const o of this.body.getWorld()) {
            if (o.kind !== "toy" || this.distTo(o.x, o.z) > 3.5 || (this.toyCooldown.get(o.id) ?? 0) > this.now())
                continue;
            this.toyCooldown.set(o.id, this.now() + 45000);
            this.boredom = clamp(this.boredom - 0.4);
            this.curiosity = clamp(this.curiosity - 0.15);
            this.valence = clamp(this.valence + 0.25, -1, 1);
            this.arousal = clamp(this.arousal + 0.2);
            this.memory.remember("played", o.id, 0.5, 0.75);
            this.event("memory", `played with ${o.id}`);
            this.feel("played", o.id);
        }
    }
    // ----- helpers
    brainReport() {
        const l = this.chem();
        if (!l)
            return undefined;
        return { emotion: l.emotion.toLowerCase(), intensity: Math.round(l.intensity * 100) / 100, because: l.because, instinct: l.instinct.toLowerCase(),
            hormones: Object.fromEntries(CHEMS.map((c) => [c.label, Math.round(l.nm[c.id] * 100)])) };
    }
    chemSummary() {
        const nm = this.chem()?.nm;
        if (!nm)
            return undefined;
        return Object.fromEntries(CHEMS.map((c) => [c.label.toLowerCase(), { level: Math.round(nm[c.id] * 100), over: nm[c.id] - c.base, role: c.role }]));
    }
    feel(kind, detail) { this.opts.onFeel?.(kind, detail); }
    chem() { return this.opts.getChem?.(); }
    personPresent() { return this.opts.getSenses?.().personPresent === true; }
    presentSecs() { return this.personSince ? (this.now() - this.personSince) / 1000 : 0; }
    ctxKey(a) { return `${this.mood()}|${this.personPresent() ? "watched" : "alone"}|${a}`; }
    /** Habituation: each repeat of a stimulus counts for less, and it recovers while nothing happens. Returns the current strength. */
    habituate(kind) { const f = this.habit[kind] ?? 1; this.habit[kind] = Math.max(0.25, f * 0.8); return f; }
    /** Say something short (cooldown-limited) without disturbing whatever the body is doing. */
    react(text, force = false) {
        if (!force && this.now() - this.lastSpokeAt < 6000)
            return;
        this.lastSpokeAt = this.now();
        this.event("speech", text);
        void this.body.act([], text);
    }
    reflex(instr) { if (!this.body.isBusy() && this.acting === 0)
        void this.body.act(instr); }
    async say(text) { this.event("speech", text); this.lastSpokeAt = this.now(); await this.body.act([], text); }
    event(t, text) {
        if (t === "speech") {
            this.spoken.push(text);
            if (this.spoken.length > 12)
                this.spoken.shift();
            this.convoPush("you", text);
        }
        this.opts.onEvent?.(t, text);
    }
    needs() { return { c: this.curiosity, b: this.boredom, s: this.social }; }
    userRecent(ms) { return this.now() - this.lastUserAt < ms; }
    distTo(x, z) { const p = this.body.getPose(); return Math.hypot(x - p.x, z - p.z) / p.unit; }
    distHome() { return this.distTo(0, 0); } // distance from the arena center
    freeToy() {
        const toys = this.body.getWorld().filter((o) => o.kind === "toy" && (this.toyCooldown.get(o.id) ?? 0) <= this.now());
        return toys.sort((a, b) => this.distTo(a.x, a.z) - this.distTo(b.x, b.z))[0];
    }
    resolveTarget(t) {
        const u = this.body.getPose().unit;
        if (t === "home" || t === "center")
            return { x: 0, z: 0, stop: 3 * u };
        const o = this.body.getWorld().find((w) => w.id === t);
        return o ? { x: o.x, z: o.z, stop: (o.r ?? 0) + 2.2 * u } : null;
    }
    willing(dance) {
        const fam = Math.min(1, this.memory.long.interactions / 20);
        const w = 0.55 + 0.35 * this.valence + 0.15 * fam + (dance ? 0.25 * this.boredom : 0.1 * this.curiosity) + (Math.random() - 0.5) * 0.2;
        return w > 0.45;
    }
    mood() {
        const lim = this.chem();
        if (lim?.asleep)
            return "sleepy";
        if (lim && lim.intensity > 0.45) {
            const m = { HAPPY: "happy", EXCITED: "excited", CURIOUS: "curious", SURPRISED: "startled", FEARFUL: "afraid", ANGRY: "angry", DISGUSTED: "disgusted", SAD: "sad", PAIN: "hurt" };
            if (m[lim.emotion])
                return m[lim.emotion];
        }
        if (this.arousal > 0.55 && this.valence > 0.3)
            return "excited";
        if (this.arousal > 0.55 && this.valence < -0.1)
            return "startled";
        if (this.personPresent() && this.arousal > 0.3)
            return "attentive";
        if (this.social > 0.75 && this.valence < 0.1)
            return "lonely";
        if (this.boredom > 0.7)
            return "bored";
        if (this.curiosity > 0.65)
            return "curious";
        if (this.valence > 0.2)
            return "content";
        return "calm";
    }
    snapshot() {
        return {
            mode: this.mode, mood: this.mood(), valence: this.valence, arousal: this.arousal,
            curiosity: this.curiosity, social: this.social, boredom: this.boredom,
            thought: this.thought, lastAction: this.lastAction, interactions: this.memory.long.interactions,
            userName: this.memory.long.userName, favorite: this.memory.long.favorite,
        };
    }
    emit() { this.opts.onUpdate?.(this.snapshot()); }
}
