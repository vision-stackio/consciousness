import { EmotionLabel, Neuromodulators, clamp } from "./types.js";

/** Read-only view of the brain used by the emotion and decision readouts. */
export interface Reader {
  /** mean activity above resting level for a region, 0..1 (both hemispheres) */
  ex(region: string): number;
  /** neuromodulator level 0..1 */
  nm: Neuromodulators;
  /** brief orienting burst right after a sudden stimulus, 0..1 */
  startle: number;
  /** slow mood valence (-1..1) — emotional inertia */
  moodValence?: number;
  /** slow mood arousal (0..1) */
  moodArousal?: number;
}

export type Scores = Record<Exclude<EmotionLabel, "NEUTRAL">, number>;

/**
 * Emotion is READ OUT of the activity pattern, never set directly.
 * Each emotion is a weighted blend of the regions that implement it.
 * Mood (slow) biases the fast emotion scores — this is emotional inertia.
 */
export function emotionScores(r: Reader): { scores: Scores; pos: number; because: Record<string, [string, number][]> } {
  const e = (id: string) => r.ex(id);
  const moodV = r.moodValence ?? 0;
  const moodA = r.moodArousal ?? 0.3;
  // base positive tone from reward circuit, slightly pulled by slow mood
  const pos = clamp(0.4 * e("NACC") + 0.25 * e("VMPFC") + 0.2 * e("VTA") + 0.15 * e("OFC") + 0.18 * moodV);
  const lc = e("LC");
  const scores: Scores = {
    HAPPY: pos * (1 - 0.4 * lc) * (1 + 0.15 * Math.max(0, moodV)),
    EXCITED: pos * (0.3 + 0.9 * lc) * (0.85 + 0.3 * moodA),
    FEARFUL: clamp(0.45 * e("AMY") + 0.2 * e("PAG") + 0.2 * lc + 0.15 * e("INS") - 0.2 * pos + 0.12 * Math.max(0, -moodV)),
    ANGRY: clamp(0.2 * e("ACC") + 0.12 * e("HYP") + 0.35 * e("PUT") + 0.15 * e("CAUD") + 0.12 * e("PMC") - 0.2 * pos + 0.08 * Math.max(0, -moodV)),
    DISGUSTED: clamp(0.45 * e("INS") + 0.25 * e("OLF") + 0.15 * e("PUT") + 0.15 * e("OFC") - 0.25 * e("S1")),
    SAD: clamp(0.4 * e("SGACC") + 0.2 * e("PCC") + 0.15 * e("INS") + 0.1 * e("AMY") + 0.12 * clamp((0.14 - r.nm.dopamine) / 0.14) - 0.25 * pos + 0.2 * Math.max(0, -moodV)),
    PAIN: 0.3 * e("S1") + 0.3 * e("ACC") + 0.25 * e("INS") + 0.15 * e("PAG"),
    CURIOUS: clamp(0.25 * e("ACC") + 0.2 * e("SC") + 0.25 * e("HIPP") + 0.15 * e("DLPFC") + 0.15 * e("VTA") - 0.3 * e("AMY") + 0.1 * moodA),
    SURPRISED: 0.5 * r.startle + 0.25 * e("SC") + 0.25 * lc,
    CALM: 0,
  };
  for (const k of Object.keys(scores) as (keyof Scores)[]) scores[k] = clamp(scores[k]);

  const because: Record<string, [string, number][]> = {
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

/** Picks a label with hysteresis so the face of the brain doesn't flicker.
 *  Also maintains a slow mood state (emotional inertia) that lasts minutes. */
export class EmotionReadout {
  current: EmotionLabel = "NEUTRAL";
  intensity = 0;
  /** Slow mood valence — changes over tens of seconds to minutes */
  moodValence = 0;
  /** Slow mood arousal */
  moodArousal = 0.3;
  private smooth: Partial<Scores> = {};
  because = "";

  update(r: Reader, dt: number): { changed: boolean } {
    // Slow mood integration (tau ~ 45–90 s). Fast emotion rides on top of this.
    const fastV = this.valence(r);
    const fastA = Math.max(
      r.ex("LC") * 0.6 + r.ex("RF") * 0.3 + (r.startle || 0) * 0.4,
      0.05
    );
    const moodTau = 55; // seconds
    const kMood = 1 - Math.exp(-dt / moodTau);
    this.moodValence = clamp(this.moodValence + (fastV - this.moodValence) * kMood, -1, 1);
    this.moodArousal = clamp(this.moodArousal + (fastA - this.moodArousal) * kMood, 0, 1);

    // Feed mood into the reader for scoring
    const rWithMood: Reader = { ...r, moodValence: this.moodValence, moodArousal: this.moodArousal };

    const { scores, because } = emotionScores(rWithMood);
    const k = 1 - Math.exp(-dt / 0.25);
    let best: EmotionLabel = "NEUTRAL", bestV = 0;
    for (const key of Object.keys(scores) as (keyof Scores)[]) {
      const s = (this.smooth[key] ?? 0) + (scores[key] - (this.smooth[key] ?? 0)) * k;
      this.smooth[key] = s;
      if (s > bestV) { bestV = s; best = key; }
    }
    const THRESH = 0.2;
    const curV = this.current === "NEUTRAL" || this.current === "CALM" ? 0 : (this.smooth[this.current as keyof Scores] ?? 0);
    let next: EmotionLabel = this.current;
    if (bestV < THRESH && curV < THRESH * 0.7) next = r.nm.serotonin > 0.5 ? "CALM" : "NEUTRAL";
    else if (best !== this.current && bestV > curV * 1.15 + 0.01 && bestV >= THRESH) next = best;
    const changed = next !== this.current;
    this.current = next;
    const v = next === "NEUTRAL" || next === "CALM" ? 0.15 : (this.smooth[next as keyof Scores] ?? 0);
    this.intensity = clamp(v / 0.65);
    if (changed) {
      const parts = (because[next] ?? []).filter(([, x]) => x > 0.05).sort((a, b) => b[1] - a[1]).slice(0, 3);
      this.because = parts.map(([id, x]) => `${id} ${Math.round(x * 100)}%`).join(", ");
    }
    return { changed };
  }

  /** Valence/arousal estimate used for the memory write-back. */
  valence(r: Reader): number {
    const { scores, pos } = emotionScores(r);
    const neg = Math.max(scores.FEARFUL, scores.ANGRY, scores.DISGUSTED, scores.SAD, scores.PAIN);
    return clamp((pos - neg) * 1.6, -1, 1);
  }
  reset() {
    this.current = "NEUTRAL"; this.intensity = 0; this.smooth = {}; this.because = "";
    this.moodValence = 0; this.moodArousal = 0.3;
  }
}
