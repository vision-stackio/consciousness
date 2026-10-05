import { clamp } from "./types.js";
import { emotionScores } from "./emotion.js";
import { mulberry32, gauss } from "./rng.js";
export const ACTIONS = ["OBSERVE", "APPROACH", "GREET", "INVESTIGATE", "FLEE", "FREEZE", "CONFRONT", "WITHDRAW", "REJECT", "RECOIL"];
const SUPPORT = {
    OBSERVE: [], APPROACH: ["NACC", "VMPFC", "VTA"], GREET: ["FFA", "TPJ", "MPFC", "NACC"],
    INVESTIGATE: ["ACC", "SC", "HIPP", "VTA"], FLEE: ["AMY", "PAG", "LC"], FREEZE: ["AMY", "PAG", "SC"],
    CONFRONT: ["PUT", "ACC", "CAUD", "HYP"], WITHDRAW: ["SGACC", "PCC", "INS"], REJECT: ["INS", "OLF", "PUT"],
    RECOIL: ["S1", "ACC", "INS", "PAG"],
};
/**
 * Race model of action selection (cortico-basal-ganglia style):
 * every possible action collects evidence from the regions that argue for it,
 * actions inhibit each other, and the first to cross a threshold is committed.
 * Noradrenaline lowers the threshold (urgency); a close race (ACC conflict)
 * raises it, so the brain "hesitates" when two options are nearly equal.
 */
export class DecisionMaker {
    x = Object.fromEntries(ACTIONS.map((a) => [a, 0]));
    input = { ...this.x };
    current = "OBSERVE";
    confidence = 0;
    threshold = 0.5;
    conflict = 0;
    heldFor = 0;
    belowFor = 0;
    sinceOnset = 99;
    rnd = mulberry32(99);
    onStimulus() { this.sinceOnset = 0; }
    update(r, dt) {
        this.sinceOnset += dt;
        this.heldFor += dt;
        const e = (id) => r.ex(id);
        const { scores, pos } = emotionScores(r);
        const fear = scores.FEARFUL;
        const social = clamp(0.5 * e("FFA") + 0.3 * e("TPJ") + 0.3 * e("MPFC") + 0.3 * e("WERN"));
        const inp = this.input;
        inp.OBSERVE = 0.22;
        inp.APPROACH = (0.5 * e("NACC") + 0.25 * e("VMPFC") + 0.25 * e("VTA")) * (1 - 0.9 * fear) * (1 - 0.6 * social) * 1.1;
        inp.GREET = social * (0.25 + pos) * clamp(1 - fear - scores.ANGRY) * 2.0;
        inp.INVESTIGATE = (0.3 * e("ACC") + 0.25 * e("SC") + 0.25 * e("HIPP") + 0.2 * e("VTA")) * (1 - 0.8 * fear) * 1.9;
        inp.FREEZE = (0.45 * e("AMY") + 0.25 * e("PAG")) * (0.35 + r.startle) * 1.5;
        inp.FLEE = fear * (0.95 - 0.55 * r.startle);
        inp.CONFRONT = scores.ANGRY * 1.9;
        inp.WITHDRAW = scores.SAD * 1.05;
        inp.REJECT = scores.DISGUSTED * 1.05;
        inp.RECOIL = scores.PAIN * 1.1;
        // evidence accumulation with leak, lateral inhibition and noise
        let total = 0;
        for (const a of ACTIONS)
            total += Math.max(0, this.x[a]);
        for (const a of ACTIONS) {
            const others = total - Math.max(0, this.x[a]);
            const dx = -1.2 * this.x[a] + 2.2 * inp[a] - 0.9 * others + 0.35 * gauss(this.rnd) / Math.sqrt(Math.max(dt, 1e-3)) * 0.08;
            this.x[a] = clamp(this.x[a] + dx * dt, 0, 1.5);
        }
        const ranked = [...ACTIONS].sort((p, q) => this.x[q] - this.x[p]);
        const lead = ranked[0], second = ranked[1];
        const gap = this.x[lead] - this.x[second];
        this.conflict = clamp(1 - gap / Math.max(this.x[lead], 0.05)) * clamp(this.x[lead] / 0.4);
        this.threshold = clamp(0.5 - 0.15 * e("LC") + 0.12 * this.conflict, 0.3, 0.7);
        if (lead !== this.current && lead !== "OBSERVE" && this.x[lead] > this.threshold && gap > 0.06 && this.heldFor > 1.2) {
            const because = SUPPORT[lead].map((id) => [id, e(id)]).filter(([, v]) => v > 0.05)
                .sort((p, q) => q[1] - p[1]).slice(0, 3).map(([id, v]) => `${id} ${Math.round(v * 100)}%`).join(", ");
            this.current = lead;
            this.heldFor = 0;
            this.belowFor = 0;
            this.confidence = clamp(this.x[lead] / (this.threshold * 1.6));
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
    reset() {
        for (const a of ACTIONS)
            this.x[a] = 0;
        this.current = "OBSERVE";
        this.confidence = 0;
        this.heldFor = 0;
        this.belowFor = 0;
        this.sinceOnset = 99;
    }
}
