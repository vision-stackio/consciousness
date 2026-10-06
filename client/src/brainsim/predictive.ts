/**
 * Lightweight generative / predictive-processing layer.
 *
 * Maintains a simple generative model of the causes of sensory observations.
 * On every stimulus it:
 *   1. Predicts expected sensory features from the current belief state
 *   2. Computes prediction error (observed − predicted)
 *   3. Updates beliefs (learning rate modulated by acetylcholine / attention)
 *   4. Supplies epistemic (information-seeking) value to the decision maker
 *
 * This is a functional approximation of predictive processing / active inference,
 * not a full free-energy minimisation scheme. It gives the brain an explicit
 * internal model that is updated by prediction error and that biases action
 * selection toward reducing uncertainty (curiosity) as well as maximising reward.
 */

import { Appraisal, Stimulus, clamp, ZERO_APPRAISAL } from "./types.js";
import { Reader } from "./emotion.js";

/** Compact feature vector the generative model tracks. */
export interface SensoryFeatures {
  valence: number;
  arousal: number;
  threat: number;
  reward: number;
  social: number;
  novelty: number;
  disgust: number;
  pain: number;
  loss: number;
  anger: number;
  face: number;
  familiarity: number;
  intensity: number;
}

const ZERO_FEATURES: SensoryFeatures = {
  valence: 0, arousal: 0, threat: 0, reward: 0, social: 0, novelty: 0.2,
  disgust: 0, pain: 0, loss: 0, anger: 0, face: 0, familiarity: 0, intensity: 0,
};

function fromAppraisal(a: Appraisal, intensity: number): SensoryFeatures {
  return {
    valence: a.valence, arousal: a.arousal, threat: a.threat, reward: a.reward,
    social: a.social, novelty: a.novelty, disgust: a.disgust, pain: a.pain,
    loss: a.loss, anger: a.anger, face: a.face, familiarity: a.familiarity,
    intensity,
  };
}

function featureKeys(): (keyof SensoryFeatures)[] {
  return Object.keys(ZERO_FEATURES) as (keyof SensoryFeatures)[];
}

/** Mean absolute prediction error across features. */
function mae(obs: SensoryFeatures, pred: SensoryFeatures): number {
  let s = 0, n = 0;
  for (const k of featureKeys()) {
    s += Math.abs(obs[k] - pred[k]);
    n++;
  }
  return n ? s / n : 0;
}

/**
 * Generative model of expected sensory causes.
 * Beliefs are a slowly evolving prior over the feature vector.
 * Context (recent stimuli, current neuromodulators) modulates predictions.
 */
export class GenerativeModel {
  /** Current belief (expected features). */
  belief: SensoryFeatures = { ...ZERO_FEATURES };

  /** Running uncertainty (higher → more epistemic drive). */
  uncertainty = 0.45;

  /** Last prediction error magnitude (0..1). */
  lastPE = 0;

  /** Per-feature signed prediction error (for UI / region drives). */
  signedPE: SensoryFeatures = { ...ZERO_FEATURES };

  /** Last observed features. */
  lastObs: SensoryFeatures = { ...ZERO_FEATURES };

  /** Last predicted features (before update). */
  lastPred: SensoryFeatures = { ...ZERO_FEATURES };

  /** Recent PE history for surprise / precision. */
  private peHistory: number[] = [];
  private readonly historyLen = 12;

  /** How much recent PE influences future uncertainty. */
  private peEma = 0.3;

  /**
   * Predict expected features given current internal state.
   * Neuromodulators and region activity gently bias the prior.
   */
  predict(r: Reader): SensoryFeatures {
    const pred = { ...this.belief };

    // High dopamine → more optimistic (higher expected reward / valence)
    const da = r.nm.dopamine;
    pred.reward = clamp(pred.reward + 0.25 * (da - 0.15));
    pred.valence = clamp(pred.valence + 0.2 * (da - 0.15), -1, 1);

    // High cortisol / noradrenaline → higher expected threat / arousal
    pred.threat = clamp(pred.threat + 0.3 * (r.nm.cortisol - 0.1) + 0.2 * (r.nm.noradrenaline - 0.1));
    pred.arousal = clamp(pred.arousal + 0.25 * (r.nm.noradrenaline - 0.1) + 0.15 * (r.nm.adrenaline - 0.05));

    // Oxytocin → higher expected social
    pred.social = clamp(pred.social + 0.35 * (r.nm.oxytocin - 0.1));

    // High uncertainty → higher expected novelty
    pred.novelty = clamp(pred.novelty + 0.4 * this.uncertainty);

    // Melatonin / sleepiness lowers expected intensity & arousal
    pred.intensity = clamp(pred.intensity - 0.3 * (r.nm.melatonin - 0.1));
    pred.arousal = clamp(pred.arousal - 0.2 * (r.nm.melatonin - 0.1));

    this.lastPred = { ...pred };
    return pred;
  }

  /**
   * Observe a stimulus, compute prediction error, update beliefs.
   * Learning rate is gated by acetylcholine (attention) and current uncertainty.
   */
  observe(stim: Stimulus, r: Reader): number {
    const obs = fromAppraisal(stim.appraisal, stim.intensity);
    this.lastObs = obs;

    const pred = this.predict(r);
    const pe = mae(obs, pred);
    this.lastPE = pe;

    // signed per-feature error for downstream use
    const signed: SensoryFeatures = { ...ZERO_FEATURES };
    for (const k of featureKeys()) {
      signed[k] = obs[k] - pred[k];
    }
    this.signedPE = signed;

    // Update PE history & uncertainty
    this.peHistory.push(pe);
    if (this.peHistory.length > this.historyLen) this.peHistory.shift();
    this.peEma = 0.7 * this.peEma + 0.3 * pe;
    // Uncertainty rises with recent PE, falls slowly otherwise
    this.uncertainty = clamp(0.55 * this.uncertainty + 0.45 * this.peEma + 0.08 * (pe > 0.35 ? 1 : 0), 0.08, 0.95);

    // Belief update (precision-weighted)
    // High ACh → sharper attention → faster belief update
    const ach = r.nm.acetylcholine;
    const lr = clamp(0.12 + 0.35 * ach + 0.2 * this.uncertainty, 0.05, 0.55);

    for (const k of featureKeys()) {
      this.belief[k] = clamp(
        this.belief[k] + lr * (obs[k] - this.belief[k]),
        k === "valence" ? -1 : 0,
        1
      );
    }

    return pe;
  }

  /**
   * Epistemic value of an action: how much it is expected to reduce uncertainty.
   * High for INVESTIGATE / OBSERVE when uncertainty or PE is high.
   * Slightly positive for APPROACH / GREET when social uncertainty is high.
   */
  epistemicValue(action: string): number {
    const u = this.uncertainty;
    const pe = this.lastPE;
    const socialU = clamp(u * (1 - this.belief.familiarity) * (0.4 + this.belief.social));

    switch (action) {
      case "INVESTIGATE":
        return clamp(0.85 * u + 0.55 * pe + 0.15 * socialU);
      case "OBSERVE":
        return clamp(0.45 * u + 0.35 * pe);
      case "APPROACH":
      case "GREET":
        return clamp(0.25 * socialU + 0.1 * pe);
      case "FLEE":
      case "FREEZE":
        // high threat PE can still drive defensive sampling
        return clamp(0.2 * Math.max(0, this.signedPE.threat) * u);
      default:
        return 0.05 * u;
    }
  }

  /** Snapshot for UI / debugging. */
  snapshot() {
    return {
      uncertainty: this.uncertainty,
      lastPE: this.lastPE,
      peEma: this.peEma,
      belief: { ...this.belief },
      lastObs: { ...this.lastObs },
      lastPred: { ...this.lastPred },
      signedPE: { ...this.signedPE },
    };
  }

  reset() {
    this.belief = { ...ZERO_FEATURES };
    this.uncertainty = 0.45;
    this.lastPE = 0;
    this.peEma = 0.3;
    this.peHistory = [];
    this.signedPE = { ...ZERO_FEATURES };
    this.lastObs = { ...ZERO_FEATURES };
    this.lastPred = { ...ZERO_FEATURES };
  }

  /** Soft decay of uncertainty while nothing interesting is happening. */
  idle(dt: number) {
    this.uncertainty = clamp(this.uncertainty - 0.015 * dt);
    this.peEma = clamp(this.peEma - 0.02 * dt);
  }
}
