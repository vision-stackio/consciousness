import { Neuromodulators } from "./types.js";

export type ChemId = keyof Neuromodulators;

export interface ChemDef {
  id: ChemId;
  label: string;
  color: string;
  /** resting level, 0..1 */
  base: number;
  /** what it does, shown as a tooltip */
  role: string;
  /** regions that release it (halos glow here) */
  source: string[];
  /** regions it flows to; "*" = spreads over the whole cortex */
  targets: string[];
  /** strength of the faint colour wash over the whole brain while it is high */
  wash: number;
}

export const CHEMS: ChemDef[] = [
  { id: "dopamine", label: "dopamine", color: "#ffc300", base: 0.1, role: "wanting and reward: 'that was better than expected'", source: ["VTA"], targets: ["NACC", "VMPFC", "OFC", "CAUD", "DLPFC"], wash: 0 },
  { id: "serotonin", label: "serotonin", color: "#2ee6a6", base: 0.4, role: "mood stability and calm", source: ["RAPHE"], targets: ["VMPFC", "AMY", "HIPP", "PCC", "DLPFC"], wash: 0.07 },
  { id: "noradrenaline", label: "noradrenaline", color: "#ff7b00", base: 0.1, role: "alertness: wakes the whole cortex up", source: ["LC"], targets: ["THAL", "AMY", "HIPP", "DLPFC", "ACC", "SC"], wash: 0 },
  { id: "adrenaline", label: "adrenaline", color: "#ff1744", base: 0.05, role: "fight-or-flight surge through the body", source: ["HYP", "RF"], targets: ["M1", "PMC", "PPC", "S1", "*"], wash: 0.13 },
  { id: "cortisol", label: "cortisol", color: "#b44dff", base: 0.1, role: "stress hormone, slow to rise and slow to fade", source: ["HYP"], targets: ["HIPP", "AMY", "VMPFC", "DLPFC", "*"], wash: 0.16 },
  { id: "oxytocin", label: "oxytocin", color: "#ff7ac8", base: 0.1, role: "bonding, trust, warmth towards people", source: ["HYP"], targets: ["AMY", "NACC", "MPFC", "TPJ", "VMPFC"], wash: 0.09 },
  { id: "endorphin", label: "endorphin", color: "#00e0ff", base: 0.1, role: "the brain's own painkiller and pleasure boost", source: ["PAG", "HYP"], targets: ["S1", "ACC", "INS", "NACC", "THAL"], wash: 0.09 },
  { id: "acetylcholine", label: "acetylcholine", color: "#b8ff4d", base: 0.15, role: "attention and learning: sharpens the senses", source: ["BF"], targets: ["V1", "A1", "HIPP", "ACC", "DLPFC", "PPC"], wash: 0 },
  { id: "gaba", label: "GABA", color: "#4d7cff", base: 0.3, role: "the brake: calms activity when the brain is too busy", source: ["THAL"], targets: ["*"], wash: 0.1 },
  { id: "melatonin", label: "melatonin", color: "#7c6bff", base: 0.1, role: "sleep hormone", source: ["HYP"], targets: ["THAL", "RF", "PCC", "*"], wash: 0.14 },
];

export const chemById = new Map(CHEMS.map((c) => [c.id, c]));
export const restingChemistry = (): Neuromodulators =>
  Object.fromEntries(CHEMS.map((c) => [c.id, c.base])) as unknown as Neuromodulators;
