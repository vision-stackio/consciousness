/** Shared by the server (terminal, image analysis, memory) and the browser (simulation, rendering). No DOM, no Node. */

export type Modality = "vision" | "text-read" | "audio" | "smell" | "taste" | "touch" | "pain" | "thought";

/** How the stimulus *means* something to the brain, before any brain region is involved. */
export interface Appraisal {
  valence: number;     // -1 (awful) .. +1 (wonderful)
  arousal: number;     // 0..1
  threat: number;      // 0..1  danger, snakes, guns, falling
  reward: number;      // 0..1  food, praise, puppies, wins
  social: number;      // 0..1  a person / voice / face is involved
  novelty: number;     // 0..1  never seen anything like it
  disgust: number;     // 0..1
  pain: number;        // 0..1  bodily pain
  loss: number;        // 0..1  grief, loneliness, failure
  anger: number;       // 0..1  insult, betrayal, injustice
  face: number;        // 0..1  a face is actually in view
  familiarity: number; // 0..1  matches a stored memory
}

export const ZERO_APPRAISAL: Appraisal = {
  valence: 0, arousal: 0, threat: 0, reward: 0, social: 0, novelty: 0.2,
  disgust: 0, pain: 0, loss: 0, anger: 0, face: 0, familiarity: 0,
};

export interface Stimulus {
  id: string;
  modality: Modality;
  /** Human-readable description shown in the HUD and terminal. */
  label: string;
  appraisal: Appraisal;
  /** 0..1 how strong the stimulus is (loud, close, large, vivid). */
  intensity: number;
  /** Seconds the stimulus stays "in front of" the brain. */
  duration: number;
  /** Optional JPEG data URL for the HUD retina card. */
  thumbnail?: string;
  /** Does it contain speech/language (drives Wernicke/Broca)? */
  hasLanguage?: boolean;
  /** Where the appraisal came from, for honesty in the HUD. */
  source: "pixels" | "pixels+tag" | "vlm" | "text" | "manual" | "memory";
  /** Key used for memory/familiarity. */
  memoryKey?: string;
}

export type EmotionLabel =
  | "NEUTRAL" | "CALM" | "HAPPY" | "EXCITED" | "CURIOUS" | "SURPRISED"
  | "FEARFUL" | "ANGRY" | "DISGUSTED" | "SAD" | "PAIN";

export type ActionLabel =
  | "OBSERVE" | "APPROACH" | "GREET" | "INVESTIGATE"
  | "FLEE" | "FREEZE" | "CONFRONT" | "WITHDRAW" | "REJECT" | "RECOIL";

export interface Neuromodulators {
  dopamine: number;
  serotonin: number;
  noradrenaline: number;
  adrenaline: number;
  cortisol: number;
  oxytocin: number;
  endorphin: number;
  acetylcholine: number;
  gaba: number;
  melatonin: number;
}

export interface RegionActivity {
  node: string;      // e.g. "NACC_L"
  region: string;    // e.g. "NACC"
  name: string;      // e.g. "Nucleus accumbens"
  rate: number;      // 0..1
}

export interface DecisionEvent {
  action: ActionLabel;
  confidence: number;   // 0..1
  reactionMs: number;
  because: string;      // top contributing regions
  time: number;
}

export interface EmotionEvent {
  emotion: EmotionLabel;
  intensity: number;
  because: string;
  time: number;
}

/** Snapshot the browser sends back to the server (and Vision can read at /api/state). */
export interface BrainReport {
  time: number;
  asleep: boolean;
  emotion: EmotionLabel;
  intensity: number;
  valence: number;
  arousal: number;
  decision: ActionLabel;
  decisionConfidence: number;
  neuromodulators: Neuromodulators;
  topRegions: { node: string; name: string; rate: number }[];
  activeStimulus: string | null;
}

export type ServerToClient =
  | { type: "hello"; memoryCount: number; hasVlm: boolean }
  | { type: "stimulus"; stimulus: Stimulus }
  | { type: "command"; cmd: "sleep" | "wake" | "reset" }
  | { type: "force"; emotion: EmotionLabel; level: number };

export type ClientToServer =
  | { type: "report"; report: BrainReport }
  | { type: "emotion"; event: EmotionEvent }
  | { type: "decision"; event: DecisionEvent }
  | { type: "episode"; stimulusId: string; memoryKey?: string; peak: EmotionLabel; valence: number; arousal: number };

export const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : v > hi ? hi : v);
