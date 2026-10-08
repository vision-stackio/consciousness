/**
 * Neural-mass anatomy aligned with the three major divisions of the human CNS.
 *
 * Real human brain (~86 billion neurons):
 *   • Cerebrum (cortex + limbic + basal ganglia + diencephalon) ≈ 16 billion (~19 %)
 *   • Cerebellum                                         ≈ 69 billion (~80 %)
 *   • Brainstem                                          ≈  1 billion (~ 1 %)
 *
 * IMPORTANT — this is NOT a full biological neuron simulation:
 *   • Not 16,000,000,000 individual cerebrum cells
 *   • Not 69,000,000,000 individual cerebellar cells
 *   • `neurons` = relative simulation weight only (ratios match real CNS packing)
 *
 * This model uses ~37 regions → ~70 nodes. The `neurons` field is a *relative
 * simulation weight* (not a literal cell count). Aggregate weights are scaled
 * so that cerebellum dominates (~80 %), cerebrum is next, brainstem is small —
 * matching the real packing ratio. Dynamics and visualisation both respect
 * these weights.
 *
 * Positions: approximate MNI-style mm, LEFT hemisphere (x < 0 = left).
 */

export type Division = "cerebrum" | "cerebellum" | "brainstem";

export type Group =
  | "visual" | "auditory" | "somato" | "motor" | "language" | "executive"
  | "limbic" | "reward" | "memory" | "default" | "olfactory" | "brainstem" | "cerebellum";

export const DIVISION_LABEL: Record<Division, string> = {
  cerebrum: "Cerebrum (~16B neurons)",
  cerebellum: "Cerebellum (~69B neurons, ~80%)",
  brainstem: "Brainstem & diencephalon (~1B neurons)",
};

export const DIVISION_COLOR: Record<Division, string> = {
  cerebrum: "#6ea8fe",
  cerebellum: "#a3e635",
  brainstem: "#ff7f50",
};

export const GROUP_COLOR: Record<Group, string> = {
  visual: "#4cc9f0",
  auditory: "#5b8cff",
  somato: "#2ec4b6",
  motor: "#7bd957",
  language: "#f78fb3",
  executive: "#f4a259",
  limbic: "#ff4d6d",
  reward: "#ffe45e",
  memory: "#c77dff",
  default: "#9d8df1",
  olfactory: "#5eead4",
  brainstem: "#ff7f50",
  cerebellum: "#a3e635",
};

export const GROUP_LABEL: Record<Group, string> = {
  visual: "vision", auditory: "hearing", somato: "touch / pain", motor: "movement",
  language: "language", executive: "thinking / control", limbic: "emotion / threat",
  reward: "reward", memory: "memory", default: "self / default mode", olfactory: "smell",
  brainstem: "arousal / survival", cerebellum: "coordination",
};

export type Kind = "shell" | "blob" | "cerebellum";

export interface RegionDef {
  id: string;
  name: string;
  division: Division;               // major CNS division
  group: Group;
  kind: Kind;
  pos: [number, number, number];    // left-hemisphere position (x<0), mm
  radii?: [number, number, number];
  weight?: number;                  // shell territory weight
  /** Relative neuron weight (simulation units). Higher = denser / more influence. */
  neurons: number;
  midline?: boolean;
  tau: number;
  rest: number;
  role: string;
}

/**
 * Relative neuron weights (simulation units).
 * Target aggregate ratio ≈ Cerebrum 19 % : Cerebellum 80 % : Brainstem 1 %.
 * Shells previously had neurons:0; they now carry cortical estimates.
 */
export const REGIONS: RegionDef[] = [
  // =====================================================================
  //  CEREBRUM — cortex, limbic, basal ganglia, thalamic relays (~19 %)
  // =====================================================================

  // ---- visual cortex & thalamic relay ---------------------------------
  { id: "LGN",  name: "Lateral geniculate (thalamic vision relay)", division: "cerebrum", group: "visual", kind: "blob", pos: [-22, -26, -3], radii: [2.6, 2.6, 2.6], neurons: 18, tau: 0.04, rest: 0.03, role: "first stop for what the eyes see" },
  { id: "V1",   name: "Primary visual cortex", division: "cerebrum", group: "visual", kind: "shell", pos: [-8, -96, 6], weight: 1.4, neurons: 140, tau: 0.06, rest: 0.04, role: "edges, light, contrast" },
  { id: "V2V4", name: "Extrastriate visual cortex (V2/V4)", division: "cerebrum", group: "visual", kind: "shell", pos: [-28, -88, -6], weight: 1.5, neurons: 160, tau: 0.07, rest: 0.04, role: "colour, shape, texture" },
  { id: "MT",   name: "Motion area (MT/V5)", division: "cerebrum", group: "visual", kind: "shell", pos: [-46, -72, 8], weight: 0.9, neurons: 70, tau: 0.07, rest: 0.03, role: "movement in the scene" },
  { id: "IT",   name: "Inferior temporal cortex (objects)", division: "cerebrum", group: "visual", kind: "shell", pos: [-58, -32, -24], weight: 1.3, neurons: 120, tau: 0.08, rest: 0.04, role: "recognising what an object is" },
  { id: "FFA",  name: "Fusiform face area", division: "cerebrum", group: "visual", kind: "shell", pos: [-40, -52, -22], weight: 1.0, neurons: 90, tau: 0.08, rest: 0.03, role: "faces" },

  // ---- auditory -------------------------------------------------------
  { id: "MGN",  name: "Medial geniculate (thalamic hearing relay)", division: "cerebrum", group: "auditory", kind: "blob", pos: [-15, -27, -4], radii: [2.6, 2.6, 2.6], neurons: 16, tau: 0.04, rest: 0.03, role: "first stop for sound" },
  { id: "A1",   name: "Primary auditory cortex", division: "cerebrum", group: "auditory", kind: "shell", pos: [-52, -20, 8], weight: 1.0, neurons: 80, tau: 0.06, rest: 0.04, role: "pitch, loudness, timing" },

  // ---- language -------------------------------------------------------
  { id: "WERN", name: "Wernicke's area (language comprehension)", division: "cerebrum", group: "language", kind: "shell", pos: [-58, -42, 12], weight: 1.1, neurons: 95, tau: 0.1, rest: 0.03, role: "understanding words" },
  { id: "BROCA",name: "Broca's area (speech production)", division: "cerebrum", group: "language", kind: "shell", pos: [-52, 18, 12], weight: 1.1, neurons: 90, tau: 0.1, rest: 0.03, role: "forming a reply" },

  // ---- somatosensory / motor cortex -----------------------------------
  { id: "S1",   name: "Somatosensory cortex", division: "cerebrum", group: "somato", kind: "shell", pos: [-42, -30, 58], weight: 1.3, neurons: 110, tau: 0.06, rest: 0.03, role: "touch, pressure, where it hurts" },
  { id: "M1",   name: "Primary motor cortex", division: "cerebrum", group: "motor", kind: "shell", pos: [-38, -14, 60], weight: 1.2, neurons: 100, tau: 0.07, rest: 0.03, role: "sending movement commands" },
  { id: "PMC",  name: "Premotor / supplementary motor", division: "cerebrum", group: "motor", kind: "shell", pos: [-22, 2, 66], weight: 1.3, neurons: 110, tau: 0.09, rest: 0.03, role: "planning movement" },
  { id: "PPC",  name: "Posterior parietal cortex", division: "cerebrum", group: "executive", kind: "shell", pos: [-34, -62, 52], weight: 1.5, neurons: 140, tau: 0.1, rest: 0.05, role: "spatial attention, where things are" },

  // ---- executive / prefrontal -----------------------------------------
  { id: "DLPFC",name: "Dorsolateral prefrontal cortex", division: "cerebrum", group: "executive", kind: "shell", pos: [-42, 32, 30], weight: 1.6, neurons: 150, tau: 0.15, rest: 0.05, role: "working memory, deliberate choice" },
  { id: "MPFC", name: "Medial prefrontal cortex", division: "cerebrum", group: "default", kind: "shell", pos: [-6, 50, 20], weight: 1.2, neurons: 110, tau: 0.15, rest: 0.07, role: "self and other people" },
  { id: "VMPFC",name: "Ventromedial prefrontal cortex", division: "cerebrum", group: "reward", kind: "shell", pos: [-8, 54, -8], weight: 1.1, neurons: 95, tau: 0.15, rest: 0.05, role: "value, calming the amygdala" },
  { id: "OFC",  name: "Orbitofrontal cortex", division: "cerebrum", group: "reward", kind: "shell", pos: [-26, 38, -18], weight: 1.1, neurons: 95, tau: 0.12, rest: 0.04, role: "how good or bad is this" },
  { id: "ACC",  name: "Anterior cingulate cortex", division: "cerebrum", group: "executive", kind: "blob", pos: [-5, 30, 20], radii: [5, 12, 8], neurons: 85, tau: 0.12, rest: 0.05, role: "conflict, effort, the 'ouch' of pain" },
  { id: "SGACC",name: "Subgenual cingulate", division: "cerebrum", group: "limbic", kind: "blob", pos: [-5, 24, -6], radii: [4, 5, 4], neurons: 40, tau: 0.2, rest: 0.04, role: "sadness and low mood" },

  // ---- default mode / social ------------------------------------------
  { id: "TPJ",  name: "Temporoparietal junction", division: "cerebrum", group: "default", kind: "shell", pos: [-56, -54, 24], weight: 1.0, neurons: 85, tau: 0.12, rest: 0.04, role: "what is that person thinking / feeling" },
  { id: "PCC",  name: "Posterior cingulate / precuneus", division: "cerebrum", group: "default", kind: "blob", pos: [-5, -50, 30], radii: [6, 12, 10], neurons: 90, tau: 0.2, rest: 0.1, role: "self, mind-wandering, rumination" },
  { id: "TPOLE",name: "Temporal pole", division: "cerebrum", group: "memory", kind: "shell", pos: [-40, 12, -30], weight: 1.0, neurons: 80, tau: 0.12, rest: 0.03, role: "meaning of people and things" },

  // ---- limbic ---------------------------------------------------------
  { id: "INS",  name: "Insula", division: "cerebrum", group: "limbic", kind: "blob", pos: [-38, 6, 2], radii: [6, 14, 10], neurons: 90, tau: 0.1, rest: 0.05, role: "gut feeling, disgust, pain, body state" },
  { id: "AMY",  name: "Amygdala", division: "cerebrum", group: "limbic", kind: "blob", pos: [-23, -4, -20], radii: [4, 4, 4], neurons: 50, tau: 0.05, rest: 0.04, role: "is this dangerous or important?" },
  { id: "HIPP", name: "Hippocampus", division: "cerebrum", group: "memory", kind: "blob", pos: [-28, -22, -12], radii: [6, 16, 5], neurons: 75, tau: 0.12, rest: 0.05, role: "have I seen this before; making memories" },
  { id: "PHC",  name: "Parahippocampal / entorhinal", division: "cerebrum", group: "memory", kind: "blob", pos: [-24, -14, -26], radii: [5, 10, 4], neurons: 50, tau: 0.12, rest: 0.04, role: "place and context memory" },
  { id: "HYP",  name: "Hypothalamus", division: "cerebrum", group: "limbic", kind: "blob", pos: [-3, -2, -12], radii: [3, 4, 4], neurons: 30, tau: 0.15, rest: 0.05, role: "stress hormones, body response" },

  // ---- reward / basal ganglia -----------------------------------------
  { id: "NACC", name: "Nucleus accumbens", division: "cerebrum", group: "reward", kind: "blob", pos: [-9, 11, -7], radii: [4, 4, 4], neurons: 40, tau: 0.08, rest: 0.03, role: "pleasure and wanting" },
  { id: "VTA",  name: "VTA / substantia nigra (dopamine)", division: "cerebrum", group: "reward", kind: "blob", pos: [-4, -17, -14], radii: [3, 3, 3], neurons: 25, tau: 0.06, rest: 0.05, role: "dopamine: 'that was better than expected'" },
  { id: "CAUD", name: "Caudate nucleus", division: "cerebrum", group: "executive", kind: "blob", pos: [-13, 12, 12], radii: [4, 9, 6], neurons: 60, tau: 0.1, rest: 0.04, role: "goal-directed action choice" },
  { id: "PUT",  name: "Putamen", division: "cerebrum", group: "motor", kind: "blob", pos: [-25, 4, 2], radii: [5, 9, 7], neurons: 75, tau: 0.09, rest: 0.04, role: "habit and motor selection" },
  { id: "THAL", name: "Thalamus (relay and gate)", division: "cerebrum", group: "executive", kind: "blob", pos: [-10, -18, 8], radii: [7, 11, 7], neurons: 95, tau: 0.05, rest: 0.08, role: "routes everything to cortex" },

  // ---- olfactory ------------------------------------------------------
  { id: "OLF",  name: "Olfactory (piriform) cortex", division: "cerebrum", group: "olfactory", kind: "blob", pos: [-18, 10, -22], radii: [5, 6, 3], neurons: 40, tau: 0.08, rest: 0.03, role: "smell, wired straight into emotion and memory" },

  // =====================================================================
  //  CEREBELLUM — ~80 % of all brain neurons
  // =====================================================================
  { id: "CB", name: "Cerebellum", division: "cerebellum", group: "cerebellum", kind: "cerebellum",
    pos: [-24, -68, -38], radii: [26, 22, 14], neurons: 11500,
    tau: 0.07, rest: 0.06,
    role: "fine motor control, balance, timing, motor learning (~80% of brain neurons)" },

  // =====================================================================
  //  BRAINSTEM — ~1 % of neurons, critical for survival
  // =====================================================================
  { id: "SC",    name: "Superior colliculus", division: "brainstem", group: "brainstem", kind: "blob", pos: [-5, -33, -4], radii: [4, 3, 3], neurons: 22, tau: 0.04, rest: 0.03, role: "snap attention to sudden things" },
  { id: "PAG",   name: "Periaqueductal grey", division: "brainstem", group: "brainstem", kind: "blob", pos: [0, -30, -10], radii: [3, 3, 4], neurons: 22, tau: 0.08, rest: 0.03, midline: true, role: "freeze / fight / flee, pain control" },
  { id: "LC",    name: "Locus coeruleus (noradrenaline)", division: "brainstem", group: "brainstem", kind: "blob", pos: [-4, -38, -26], radii: [2, 2, 2], neurons: 12, tau: 0.08, rest: 0.05, role: "alertness: wakes the whole cortex up" },
  { id: "RAPHE", name: "Raphe nuclei (serotonin)", division: "brainstem", group: "brainstem", kind: "blob", pos: [0, -27, -24], radii: [2, 2, 7], neurons: 18, tau: 0.2, rest: 0.1, midline: true, role: "mood stability and calm" },
  { id: "BF",    name: "Basal forebrain (acetylcholine)", division: "brainstem", group: "brainstem", kind: "blob", pos: [-9, 8, -13], radii: [4, 4, 3], neurons: 20, tau: 0.08, rest: 0.04, role: "attention: sprays acetylcholine over the cortex" },
  { id: "RF",    name: "Reticular formation / brainstem", division: "brainstem", group: "brainstem", kind: "blob", pos: [0, -30, -46], radii: [6, 6, 14], neurons: 45, tau: 0.1, rest: 0.08, midline: true, role: "wakefulness and basic arousal" },
];

export interface NodeInfo {
  index: number;
  node: string;
  region: RegionDef;
  hemi: "L" | "R" | "M";
}

export function buildNodes(): NodeInfo[] {
  const nodes: NodeInfo[] = [];
  for (const region of REGIONS) {
    const hemis: ("L" | "R" | "M")[] = region.midline ? ["M"] : ["L", "R"];
    for (const hemi of hemis) {
      nodes.push({
        index: nodes.length,
        node: hemi === "M" ? region.id : `${region.id}_${hemi}`,
        region,
        hemi,
      });
    }
  }
  return nodes;
}

export const regionById = new Map(REGIONS.map((r) => [r.id, r]));

/** Aggregate relative neuron weight by major division (for UI / diagnostics). */
export function divisionNeuronTotals(): Record<Division, number> {
  const t: Record<Division, number> = { cerebrum: 0, cerebellum: 0, brainstem: 0 };
  for (const r of REGIONS) {
    // bilateral regions count twice in the real brain; midline once
    const factor = r.midline ? 1 : 2;
    t[r.division] += r.neurons * factor;
  }
  return t;
}
