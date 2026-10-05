import { clamp } from "./types.js";
/**
 * Emotion is READ OUT of the activity pattern, never set directly.
 * Each emotion is a weighted blend of the regions that implement it.
 */
export function emotionScores(r) {
    const e = (id) => r.ex(id);
    const pos = 0.4 * e("NACC") + 0.25 * e("VMPFC") + 0.2 * e("VTA") + 0.15 * e("OFC");
    const lc = e("LC");
    const scores = {
        HAPPY: pos * (1 - 0.4 * lc),
        EXCITED: pos * (0.3 + 0.9 * lc),
        FEARFUL: 0.45 * e("AMY") + 0.2 * e("PAG") + 0.2 * lc + 0.15 * e("INS") - 0.2 * pos,
        ANGRY: 0.2 * e("ACC") + 0.12 * e("HYP") + 0.35 * e("PUT") + 0.15 * e("CAUD") + 0.12 * e("PMC") - 0.2 * pos,
        DISGUSTED: 0.45 * e("INS") + 0.25 * e("OLF") + 0.15 * e("PUT") + 0.15 * e("OFC") - 0.25 * e("S1"),
        SAD: 0.4 * e("SGACC") + 0.2 * e("PCC") + 0.15 * e("INS") + 0.1 * e("AMY") + 0.12 * clamp((0.14 - r.nm.dopamine) / 0.14) - 0.25 * pos,
        PAIN: 0.3 * e("S1") + 0.3 * e("ACC") + 0.25 * e("INS") + 0.15 * e("PAG"),
        CURIOUS: 0.25 * e("ACC") + 0.2 * e("SC") + 0.25 * e("HIPP") + 0.15 * e("DLPFC") + 0.15 * e("VTA") - 0.3 * e("AMY"),
        SURPRISED: 0.5 * r.startle + 0.25 * e("SC") + 0.25 * lc,
        CALM: 0,
    };
    for (const k of Object.keys(scores))
        scores[k] = clamp(scores[k]);
    const because = {
        HAPPY: [["NACC", e("NACC")], ["VMPFC", e("VMPFC")], ["VTA", e("VTA")], ["OFC", e("OFC")]],
        EXCITED: [["NACC", e("NACC")], ["LC", lc], ["VTA", e("VTA")], ["VMPFC", e("VMPFC")]],
        FEARFUL: [["AMY", e("AMY")], ["PAG", e("PAG")], ["LC", lc], ["INS", e("INS")]],
        ANGRY: [["PUT", e("PUT")], ["ACC", e("ACC")], ["CAUD", e("CAUD")], ["HYP", e("HYP")]],
        DISGUSTED: [["INS", e("INS")], ["OLF", e("OLF")], ["PUT", e("PUT")], ["OFC", e("OFC")]],
        SAD: [["SGACC", e("SGACC")], ["PCC", e("PCC")], ["INS", e("INS")]],
        PAIN: [["S1", e("S1")], ["ACC", e("ACC")], ["INS", e("INS")], ["PAG", e("PAG")]],
        CURIOUS: [["HIPP", e("HIPP")], ["ACC", e("ACC")], ["SC", e("SC")], ["DLPFC", e("DLPFC")]],
        SURPRISED: [["SC", e("SC")], ["LC", lc], ["AMY", e("AMY")]],
        CALM: [["RAPHE", e("RAPHE")]],
    };
    return { scores, pos, because };
}
/** Picks a label with hysteresis so the face of the brain doesn't flicker. */
export class EmotionReadout {
    current = "NEUTRAL";
    intensity = 0;
    smooth = {};
    because = "";
    update(r, dt) {
        const { scores, because } = emotionScores(r);
        const k = 1 - Math.exp(-dt / 0.25);
        let best = "NEUTRAL", bestV = 0;
        for (const key of Object.keys(scores)) {
            const s = (this.smooth[key] ?? 0) + (scores[key] - (this.smooth[key] ?? 0)) * k;
            this.smooth[key] = s;
            if (s > bestV) {
                bestV = s;
                best = key;
            }
        }
        const THRESH = 0.2;
        const curV = this.current === "NEUTRAL" || this.current === "CALM" ? 0 : (this.smooth[this.current] ?? 0);
        let next = this.current;
        if (bestV < THRESH && curV < THRESH * 0.7)
            next = r.nm.serotonin > 0.5 ? "CALM" : "NEUTRAL";
        else if (best !== this.current && bestV > curV * 1.15 + 0.01 && bestV >= THRESH)
            next = best;
        const changed = next !== this.current;
        this.current = next;
        const v = next === "NEUTRAL" || next === "CALM" ? 0.15 : (this.smooth[next] ?? 0);
        this.intensity = clamp(v / 0.65);
        if (changed) {
            const parts = (because[next] ?? []).filter(([, x]) => x > 0.05).sort((a, b) => b[1] - a[1]).slice(0, 3);
            this.because = parts.map(([id, x]) => `${id} ${Math.round(x * 100)}%`).join(", ");
        }
        return { changed };
    }
    /** Valence/arousal estimate used for the memory write-back. */
    valence(r) {
        const { scores, pos } = emotionScores(r);
        const neg = Math.max(scores.FEARFUL, scores.ANGRY, scores.DISGUSTED, scores.SAD, scores.PAIN);
        return clamp((pos - neg) * 1.6, -1, 1);
    }
    reset() { this.current = "NEUTRAL"; this.intensity = 0; this.smooth = {}; this.because = ""; }
}
