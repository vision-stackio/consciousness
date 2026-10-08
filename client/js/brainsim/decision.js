import { clamp } from "./types.js";
import { emotionScores } from "./emotion.js";
import { mulberry32, gauss } from "./rng.js";
export const ACTIONS = ["OBSERVE", "APPROACH", "GREET", "INVESTIGATE", "FLEE", "FREEZE", "CONFRONT", "WITHDRAW", "REJECT", "RECOIL"];
const SUPPORT = {
    OBSERVE: [], APPROACH: ["NACC", "VMPFC", "VTA", "CB"], GREET: ["FFA", "TPJ", "MPFC", "NACC"],
    INVESTIGATE: ["ACC", "SC", "HIPP", "VTA", "CB"], FLEE: ["AMY", "PAG", "LC"], FREEZE: ["AMY", "PAG", "SC"],
    CONFRONT: ["PUT", "ACC", "CAUD", "HYP", "CB"], WITHDRAW: ["SGACC", "PCC", "INS"], REJECT: ["INS", "OLF", "PUT"],
    RECOIL: ["S1", "ACC", "INS", "PAG"],
};
/**
 * Race model of action selection (cortico-basal-ganglia style) with
 * experience-dependent learning + epistemic (information-seeking) value
 * from the generative / predictive-processing layer.
 *
 * - Every action collects evidence from the regions that support it.
 * - Actions inhibit each other; first to cross a dynamic threshold wins.
 * - Learned action values (updated by dopamine / reward prediction error)
 *   bias the evidence accumulation. This is how the brain develops its
 *   own preferences and "intelligence" from experience instead of
 *   hard-coded rules.
 * - Region→action influence gains are also plastic (three-factor rule).
 * - Epistemic value from the generative model adds curiosity / uncertainty
 *   reduction drive (active-inference flavour).
 */
export class DecisionMaker {
    x = Object.fromEntries(ACTIONS.map((a) => [a, 0]));
    input = { ...this.x };
    current = "OBSERVE";
    confidence = 0;
    threshold = 0.5;
    conflict = 0;
    /** Learned value of each action (-1 .. +1). Starts near 0 and drifts with experience. */
    value = Object.fromEntries(ACTIONS.map((a) => [a, 0]));
    /** Eligibility trace for credit assignment (decays over ~2-4 s). */
    eligibility = Object.fromEntries(ACTIONS.map((a) => [a, 0]));
    /** Plastic gain from each supporting region onto each action (starts at 1). */
    regionGain = {};
    heldFor = 0;
    belowFor = 0;
    sinceOnset = 99;
    rnd = mulberry32(99);
    lastRpe = 0;
    /** Optional link to the generative model for epistemic value. */
    gen = null;
    /** Attach / replace the generative model (called by BrainSim). */
    setGenerativeModel(g) { this.gen = g; }
    constructor() {
        // initialise region gains to 1.0 for every known support link
        for (const a of ACTIONS) {
            for (const reg of SUPPORT[a]) {
                this.regionGain[`${reg}->${a}`] = 1.0;
            }
        }
    }
    onStimulus() { this.sinceOnset = 0; }
    /**
     * Called by BrainSim when a meaningful outcome occurs (reward, threat resolved, etc.).
     * rpe = reward prediction error (positive = better than expected).
     * Learning rate is modest so personality changes gradually.
     */
    learn(rpe, dt = 0.05) {
        this.lastRpe = rpe;
        const lr = 0.08; // value learning rate
        const lrGain = 0.04; // region-gain learning rate
        const decay = Math.exp(-dt / 3.0);
        for (const a of ACTIONS) {
            // value update (actor-critic style)
            this.value[a] = clamp(this.value[a] + lr * rpe * this.eligibility[a], -1, 1);
            this.eligibility[a] *= decay;
            // three-factor plasticity on region→action gains
            if (Math.abs(rpe) > 0.05) {
                for (const reg of SUPPORT[a]) {
                    const key = `${reg}->${a}`;
                    const g = this.regionGain[key] ?? 1;
                    // only change gains for actions that were recently eligible
                    this.regionGain[key] = clamp(g + lrGain * rpe * this.eligibility[a], 0.25, 2.5);
                }
            }
        }
    }
    /** Mark the currently selected action as eligible for upcoming reward. */
    tagEligibility(action) {
        this.eligibility[action] = 1.0;
        // soft eligibility for similar actions (generalisation)
        for (const a of ACTIONS) {
            if (a !== action)
                this.eligibility[a] = Math.max(this.eligibility[a], 0.15);
        }
    }
    update(r, dt) {
        this.sinceOnset += dt;
        this.heldFor += dt;
        const e = (id) => r.ex(id);
        const { scores, pos } = emotionScores(r);
        const fear = scores.FEARFUL;
        const social = clamp(0.5 * e("FFA") + 0.3 * e("TPJ") + 0.3 * e("MPFC") + 0.3 * e("WERN"));
        // helper: region activity scaled by learned gain
        const g = (reg, action) => e(reg) * (this.regionGain[`${reg}->${action}`] ?? 1);
        const inp = this.input;
        // Base drives (still present so the system is not blank at birth)
        // + learned value bias (this is the "own intelligence" component)
        // + epistemic value from the generative model (curiosity / uncertainty reduction)
        const valBias = (a) => 0.55 * this.value[a];
        const epi = (a) => this.gen ? 0.55 * this.gen.epistemicValue(a) : 0;
        inp.OBSERVE = 0.22 + valBias("OBSERVE") + epi("OBSERVE");
        inp.APPROACH = (0.5 * g("NACC", "APPROACH") + 0.25 * g("VMPFC", "APPROACH") + 0.25 * g("VTA", "APPROACH"))
            * (1 - 0.9 * fear) * (1 - 0.6 * social) * 1.1 + valBias("APPROACH") + epi("APPROACH");
        inp.GREET = social * (0.25 + pos) * clamp(1 - fear - scores.ANGRY) * 2.0 + valBias("GREET") + epi("GREET");
        inp.INVESTIGATE = (0.3 * g("ACC", "INVESTIGATE") + 0.25 * g("SC", "INVESTIGATE") + 0.25 * g("HIPP", "INVESTIGATE") + 0.2 * g("VTA", "INVESTIGATE"))
            * (1 - 0.8 * fear) * 1.9 + valBias("INVESTIGATE") + epi("INVESTIGATE");
        inp.FREEZE = (0.45 * g("AMY", "FREEZE") + 0.25 * g("PAG", "FREEZE")) * (0.35 + r.startle) * 1.5 + valBias("FREEZE") + epi("FREEZE");
        inp.FLEE = fear * (0.95 - 0.55 * r.startle) + valBias("FLEE") + epi("FLEE");
        inp.CONFRONT = scores.ANGRY * 1.9 + valBias("CONFRONT") + epi("CONFRONT");
        inp.WITHDRAW = scores.SAD * 1.05 + valBias("WITHDRAW") + epi("WITHDRAW");
        inp.REJECT = scores.DISGUSTED * 1.05 + valBias("REJECT") + epi("REJECT");
        inp.RECOIL = scores.PAIN * 1.1 + valBias("RECOIL") + epi("RECOIL");
        // evidence accumulation with leak, lateral inhibition and noise
        let total = 0;
        for (const a of ACTIONS)
            total += Math.max(0, this.x[a]);
        for (const a of ACTIONS) {
            const others = total - Math.max(0, this.x[a]);
            // Human-like noise: higher under conflict and extreme arousal
            const noiseScale = 0.08 + 0.12 * this.conflict + 0.06 * Math.abs(e("LC") - 0.3);
            const dx = -1.2 * this.x[a] + 2.2 * inp[a] - 0.9 * others + 0.35 * gauss(this.rnd) / Math.sqrt(Math.max(dt, 1e-3)) * noiseScale;
            this.x[a] = clamp(this.x[a] + dx * dt, 0, 1.5);
        }
        const ranked = [...ACTIONS].sort((p, q) => this.x[q] - this.x[p]);
        const lead = ranked[0], second = ranked[1];
        const gap = this.x[lead] - this.x[second];
        this.conflict = clamp(1 - gap / Math.max(this.x[lead], 0.05)) * clamp(this.x[lead] / 0.4);
        this.threshold = clamp(0.5 - 0.15 * e("LC") + 0.12 * this.conflict, 0.3, 0.7);
        // Hesitation: under high conflict require longer evidence accumulation
        const minHold = 1.2 + 1.4 * this.conflict;
        if (lead !== this.current && lead !== "OBSERVE" && this.x[lead] > this.threshold && gap > 0.06 && this.heldFor > minHold) {
            const because = SUPPORT[lead].map((id) => [id, e(id)]).filter(([, v]) => v > 0.05)
                .sort((p, q) => q[1] - p[1]).slice(0, 3).map(([id, v]) => `${id} ${Math.round(v * 100)}%`).join(", ");
            this.current = lead;
            this.heldFor = 0;
            this.belowFor = 0;
            this.confidence = clamp(this.x[lead] / (this.threshold * 1.6));
            this.tagEligibility(lead);
            return { action: lead, confidence: this.confidence, reactionMs: Math.round(this.sinceOnset * 1000), because };
        }
        // when the evidence for the held action fades, go back to watching
        if (this.current !== "OBSERVE" && this.x[this.current] < this.threshold * 0.55) {
            this.belowFor += dt;
            if (this.belowFor > 1.5) {
                this.current = "OBSERVE";
                this.confidence = 0;
                this.heldFor = 0;
                this.belowFor = 0;
                return { action: "OBSERVE", confidence: 0.4, reactionMs: 0, because: "evidence faded" };
            }
        }
        else
            this.belowFor = 0;
        return null;
    }
    /** Snapshot of learned state (useful for debugging / UI). */
    learnedState() {
        return {
            values: { ...this.value },
            topGains: Object.entries(this.regionGain)
                .filter(([, g]) => Math.abs(g - 1) > 0.08)
                .sort((a, b) => Math.abs(b[1] - 1) - Math.abs(a[1] - 1))
                .slice(0, 8)
                .map(([k, g]) => `${k}: ${g.toFixed(2)}`),
            lastRpe: this.lastRpe,
        };
    }
    /** Serialize only the durable learned parts (survives page reload). */
    exportLearning() {
        return { values: { ...this.value }, regionGain: { ...this.regionGain } };
    }
    importLearning(data) {
        if (!data)
            return;
        if (data.values) {
            for (const a of ACTIONS) {
                if (typeof data.values[a] === "number")
                    this.value[a] = clamp(data.values[a], -1, 1);
            }
        }
        if (data.regionGain) {
            for (const [k, g] of Object.entries(data.regionGain)) {
                if (typeof g === "number")
                    this.regionGain[k] = clamp(g, 0.25, 2.5);
            }
        }
    }
    reset() {
        for (const a of ACTIONS) {
            this.x[a] = 0;
            this.value[a] = 0;
            this.eligibility[a] = 0;
        }
        for (const k of Object.keys(this.regionGain))
            this.regionGain[k] = 1.0;
        this.current = "OBSERVE";
        this.confidence = 0;
        this.heldFor = 0;
        this.belowFor = 0;
        this.sinceOnset = 99;
        this.lastRpe = 0;
    }
}
