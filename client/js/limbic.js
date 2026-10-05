/**
 * Vision's emotional brain: a neural-mass model (77 nodes, ~130 pathways, ten neuromodulators)
 * from the Artificial Brain project. Vision's experiences are appraised here and the model
 * answers with real-looking chemistry (dopamine, cortisol, oxytocin...) and an emotion that is
 * READ OUT of which regions are active. It never sets an emotion directly.
 *
 * The mind (brain.ts) feeds it events and reads the chemistry back, so hormones really change
 * what Vision wants to do: dopamine pushes play, cortisol pushes him to withdraw, oxytocin to company.
 */
import { BrainSim } from "./brainsim/simulation.js";
import { appraiseText, finishAppraisal } from "./brainsim/lexicon.js";
import { CHEMS } from "./brainsim/chem.js";
import { ZERO_APPRAISAL } from "./brainsim/types.js";
const ap = (p) => finishAppraisal({ ...ZERO_APPRAISAL, ...p });
const DANGER = new Set(["knife", "scissors", "fork"]);
const LOVED = new Set(["cat", "dog", "bird", "teddy bear", "horse", "sheep", "cow"]);
const FOOD = new Set(["pizza", "cake", "apple", "banana", "donut", "sandwich", "orange", "cookie", "hot dog", "broccoli", "carrot"]);
let counter = 0;
const mk = (modality, label, a, intensity, duration, extra = {}) => ({ id: `v${(counter++).toString(36)}`, modality, label, appraisal: a, intensity, duration, source: "manual", ...extra });
export class Limbic {
    sim = new BrainSim();
    count = new Map();
    constructor() { this.sim.step(3); } // let the resting state settle
    bump(key) { const n = (this.count.get(key) ?? 0) + 1; this.count.set(key, n); return n; }
    /** How Vision's experiences become brain input. Repeats feel less novel (familiarity). */
    stimulusFor(kind, detail = "") {
        const n = this.bump(`${kind}:${detail}`);
        const novelty = (base) => (n > 1 ? base * Math.max(0.3, 1 - 0.18 * (n - 1)) : base);
        const familiarity = Math.min(0.8, 0.2 * (n - 1));
        switch (kind) {
            case "praise": return mk("audio", "praise", ap({ reward: 0.8, social: 0.9, novelty: 0.25 }), 0.7, 5, { hasLanguage: true });
            case "scold": return mk("audio", "a scolding", ap({ threat: 0.3, loss: 0.5, anger: 0.15, social: 0.85, novelty: 0.3 }), 0.8, 3, { hasLanguage: true });
            case "loud_noise": return mk("audio", "a loud noise", ap({ threat: 0.75, novelty: novelty(0.85) }), 0.95, 1.2);
            case "poke": return mk("touch", "a poke", ap({ novelty: novelty(0.55), threat: 0.12, social: 0.5, pain: 0.1 }), 0.6, 1);
            case "gift": return mk("vision", "a new toy", ap({ reward: 0.85, novelty: novelty(0.7) }), 0.8, 3);
            case "motion": return mk("vision", "sudden movement", ap({ novelty: novelty(0.55), threat: 0.15 }), 0.55, 1.5);
            case "dark": return mk("vision", "the lights going out", ap({ threat: 0.2, novelty: novelty(0.5) }), 0.5, 2);
            case "bright": return mk("vision", "the lights coming on", ap({ novelty: novelty(0.45), reward: 0.1 }), 0.5, 2);
            case "ignored": return mk("thought", "being ignored", ap({ loss: 0.55 }), 0.5, 4);
            case "teleport": return mk("touch", "being picked up and moved", ap({ threat: 0.45, novelty: 0.9 }), 0.9, 2);
            case "person_arrived": return mk("vision", "someone arrived", ap({ social: 0.8, face: 0.8, reward: 0.55, novelty: novelty(0.6), familiarity }), 0.75, 4);
            case "person_left": return mk("thought", "someone leaving", ap({ loss: 0.3, social: 0.3 }), 0.4, 3);
            case "object_shown":
            case "object_seen": {
                const shown = kind === "object_shown";
                const a = ap({
                    novelty: novelty(shown ? 0.8 : 0.35), social: shown ? 0.5 : 0, familiarity,
                    reward: LOVED.has(detail) ? 0.8 : FOOD.has(detail) ? 0.6 : shown ? 0.35 : 0.1,
                    threat: DANGER.has(detail) ? 0.55 : 0,
                });
                return mk("vision", shown ? `being shown ${detail}` : `a ${detail}`, a, shown ? 0.7 : 0.4, shown ? 3 : 2);
            }
            case "arena_seen": return mk("vision", `the ${detail}`, ap({ novelty: novelty(0.2), reward: /toy/.test(detail) ? 0.15 : 0 }), 0.2, 1.5);
            case "heard": {
                const r = appraiseText(detail);
                const a = { ...r.appraisal, social: Math.max(r.appraisal.social, 0.4) };
                return mk("audio", detail.slice(0, 60), finishAppraisal(a), r.matched.length ? r.intensity : 0.3, Math.min(8, 2.2 + detail.split(/\s+/).length * 0.4), { hasLanguage: true, source: "text" });
            }
            case "played": return mk("thought", "playing with a toy", ap({ reward: 0.65, novelty: novelty(0.3) }), 0.6, 2.5);
            case "discovered": return mk("thought", "finding somewhere new", ap({ novelty: 0.7, reward: 0.4 }), 0.6, 2.5);
            case "danced": return mk("thought", "dancing", ap({ reward: 0.55 }), 0.5, 3);
            case "refused": return mk("thought", "saying no", ap({ loss: 0.15, anger: 0.1 }), 0.3, 2);
            case "obeyed": return mk("thought", "helping", ap({ reward: 0.25, social: 0.4 }), 0.3, 2);
            // slow internal drives (called by the mind when a need gets strong)
            case "lonely": return mk("thought", "loneliness", ap({ loss: 0.4 }), 0.35, 4);
            case "bored": return mk("thought", "boredom", ap({ loss: 0.18 }), 0.3, 4);
            case "company": return mk("vision", "having company", ap({ social: 0.6, face: 0.4, reward: 0.3 }), 0.4, 6);
            case "wondering": return mk("thought", "wondering what's out there", ap({ novelty: 0.45 }), 0.3, 3);
            case "sleep":
            case "wake": return null;
        }
    }
    feel(kind, detail = "") {
        if (kind === "sleep") {
            this.sim.sleep();
            return;
        }
        if (kind === "wake") {
            this.sim.wake();
            return;
        }
        const s = this.stimulusFor(kind, detail);
        if (s) {
            if (this.sim.asleep && kind !== "loud_noise" && kind !== "teleport")
                this.sim.wake();
            this.sim.stimulate(s);
        }
    }
    step(dt) { this.sim.step(dt); }
    state() {
        const s = this.sim;
        return {
            emotion: s.emotion.current, intensity: s.emotion.intensity, because: s.emotion.because,
            nm: s.nm, asleep: s.asleep, instinct: s.decision.current, instinctConfidence: s.decision.confidence,
        };
    }
    /** The chemicals currently above their resting level, strongest first, with what each one does. */
    elevated(limit = 3) {
        return CHEMS.map((c) => ({ id: c.id, label: c.label, level: this.sim.nm[c.id], over: this.sim.nm[c.id] - c.base, role: c.role }))
            .filter((c) => c.over > 0.1).sort((a, b) => b.over - a.over).slice(0, limit)
            .map(({ id, label, level, role }) => ({ id, label, level: Math.round(level * 100), role }));
    }
}
