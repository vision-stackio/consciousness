/**
 * The anatomy: 37 regions, most of them bilateral -> ~70 simulated nodes.
 * Positions are approximate MNI-style millimetres for the LEFT hemisphere
 * (x < 0 = left, y > 0 = anterior, z > 0 = superior). They are placed to be
 * anatomically sensible, not to be a surface-accurate atlas.
 */

export type Group =
  | "visual" | "auditory" | "somato" | "motor" | "language" | "executive"
  | "limbic" | "reward" | "memory" | "default" | "olfactory" | "brainstem" | "cerebellum";

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
  group: Group;
  kind: Kind;
  pos: [number, number, number];   // left-hemisphere position (x<0), mm
  radii?: [number, number, number]; // blob / cerebellum extents
  weight?: number;                  // shell territory weight (bigger = larger patch of cortex)
  neurons: number;                  // blobs + cerebellum: count per hemisphere. shells: ignored (tiled)
  midline?: boolean;
  tau: number;                      // response time constant, seconds
  rest: number;                     // spontaneous activity
  role: string;
}

export const REGIONS: RegionDef[] = [
  // ---- visual ---------------------------------------------------------------
  { id: "LGN", name: "Lateral geniculate (thalamic vision relay)", group: "visual", kind: "blob", pos: [-22, -26, -3], radii: [2.6, 2.6, 2.6], neurons: 20, tau: 0.04, rest: 0.03, role: "first stop for what the eyes see" },
  { id: "V1", name: "Primary visual cortex", group: "visual", kind: "shell", pos: [-8, -96, 6], weight: 1.0, neurons: 0, tau: 0.06, rest: 0.04, role: "edges, light, contrast" },
  { id: "V2V4", name: "Extrastriate visual cortex (V2/V4)", group: "visual", kind: "shell", pos: [-28, -88, -6], weight: 1.2, neurons: 0, tau: 0.07, rest: 0.04, role: "colour, shape, texture" },
  { id: "MT", name: "Motion area (MT/V5)", group: "visual", kind: "shell", pos: [-46, -72, 8], weight: 0.8, neurons: 0, tau: 0.07, rest: 0.03, role: "movement in the scene" },
  { id: "IT", name: "Inferior temporal cortex (objects)", group: "visual", kind: "shell", pos: [-58, -32, -24], weight: 1.1, neurons: 0, tau: 0.08, rest: 0.04, role: "recognising what an object is" },
  { id: "FFA", name: "Fusiform face area", group: "visual", kind: "shell", pos: [-40, -52, -22], weight: 0.9, neurons: 0, tau: 0.08, rest: 0.03, role: "faces" },
  // ---- hearing / language -----------------------------------------------------
  { id: "MGN", name: "Medial geniculate (thalamic hearing relay)", group: "auditory", kind: "blob", pos: [-15, -27, -4], radii: [2.6, 2.6, 2.6], neurons: 20, tau: 0.04, rest: 0.03, role: "first stop for sound" },
  { id: "A1", name: "Primary auditory cortex", group: "auditory", kind: "shell", pos: [-52, -20, 8], weight: 0.8, neurons: 0, tau: 0.06, rest: 0.04, role: "pitch, loudness, timing" },
  { id: "WERN", name: "Wernicke's area (language comprehension)", group: "language", kind: "shell", pos: [-58, -42, 12], weight: 0.9, neurons: 0, tau: 0.1, rest: 0.03, role: "understanding words" },
  { id: "BROCA", name: "Broca's area (speech production)", group: "language", kind: "shell", pos: [-52, 18, 12], weight: 0.9, neurons: 0, tau: 0.1, rest: 0.03, role: "forming a reply" },
  // ---- body / movement ------------------------------------------------------
  { id: "S1", name: "Somatosensory cortex", group: "somato", kind: "shell", pos: [-42, -30, 58], weight: 1.1, neurons: 0, tau: 0.06, rest: 0.03, role: "touch, pressure, where it hurts" },
  { id: "M1", name: "Primary motor cortex", group: "motor", kind: "shell", pos: [-38, -14, 60], weight: 1.0, neurons: 0, tau: 0.07, rest: 0.03, role: "sending movement commands" },
  { id: "PMC", name: "Premotor / supplementary motor", group: "motor", kind: "shell", pos: [-22, 2, 66], weight: 1.1, neurons: 0, tau: 0.09, rest: 0.03, role: "planning movement" },
  { id: "PPC", name: "Posterior parietal cortex", group: "executive", kind: "shell", pos: [-34, -62, 52], weight: 1.3, neurons: 0, tau: 0.1, rest: 0.05, role: "spatial attention, where things are" },
  { id: "CB", name: "Cerebellum", group: "cerebellum", kind: "cerebellum", pos: [-24, -68, -38], radii: [24, 20, 12], neurons: 300, tau: 0.08, rest: 0.05, role: "smoothing and timing movement" },
  // ---- social / executive -----------------------------------------------------
  { id: "TPJ", name: "Temporoparietal junction", group: "default", kind: "shell", pos: [-56, -54, 24], weight: 0.8, neurons: 0, tau: 0.12, rest: 0.04, role: "what is that person thinking / feeling" },
  { id: "DLPFC", name: "Dorsolateral prefrontal cortex", group: "executive", kind: "shell", pos: [-42, 32, 30], weight: 1.4, neurons: 0, tau: 0.15, rest: 0.05, role: "working memory, deliberate choice" },
  { id: "MPFC", name: "Medial prefrontal cortex", group: "default", kind: "shell", pos: [-6, 50, 20], weight: 1.0, neurons: 0, tau: 0.15, rest: 0.07, role: "self and other people" },
  { id: "VMPFC", name: "Ventromedial prefrontal cortex", group: "reward", kind: "shell", pos: [-8, 54, -8], weight: 1.0, neurons: 0, tau: 0.15, rest: 0.05, role: "value, calming the amygdala" },
  { id: "OFC", name: "Orbitofrontal cortex", group: "reward", kind: "shell", pos: [-26, 38, -18], weight: 1.0, neurons: 0, tau: 0.12, rest: 0.04, role: "how good or bad is this" },
  { id: "TPOLE", name: "Temporal pole", group: "memory", kind: "shell", pos: [-40, 12, -30], weight: 0.9, neurons: 0, tau: 0.12, rest: 0.03, role: "meaning of people and things" },
  { id: "ACC", name: "Anterior cingulate cortex", group: "executive", kind: "blob", pos: [-5, 30, 20], radii: [5, 12, 8], neurons: 70, tau: 0.12, rest: 0.05, role: "conflict, effort, the 'ouch' of pain" },
  { id: "SGACC", name: "Subgenual cingulate", group: "limbic", kind: "blob", pos: [-5, 24, -6], radii: [4, 5, 4], neurons: 30, tau: 0.2, rest: 0.04, role: "sadness and low mood" },
  { id: "PCC", name: "Posterior cingulate / precuneus", group: "default", kind: "blob", pos: [-5, -50, 30], radii: [6, 12, 10], neurons: 80, tau: 0.2, rest: 0.1, role: "self, mind-wandering, rumination" },
  { id: "INS", name: "Insula", group: "limbic", kind: "blob", pos: [-38, 6, 2], radii: [6, 14, 10], neurons: 80, tau: 0.1, rest: 0.05, role: "gut feeling, disgust, pain, body state" },
  // ---- limbic / memory --------------------------------------------------------
  { id: "AMY", name: "Amygdala", group: "limbic", kind: "blob", pos: [-23, -4, -20], radii: [4, 4, 4], neurons: 44, tau: 0.05, rest: 0.04, role: "is this dangerous or important?" },
  { id: "HIPP", name: "Hippocampus", group: "memory", kind: "blob", pos: [-28, -22, -12], radii: [6, 16, 5], neurons: 70, tau: 0.12, rest: 0.05, role: "have I seen this before; making memories" },
  { id: "PHC", name: "Parahippocampal / entorhinal", group: "memory", kind: "blob", pos: [-24, -14, -26], radii: [5, 10, 4], neurons: 44, tau: 0.12, rest: 0.04, role: "place and context memory" },
  { id: "HYP", name: "Hypothalamus", group: "limbic", kind: "blob", pos: [-3, -2, -12], radii: [3, 4, 4], neurons: 36, tau: 0.15, rest: 0.05, role: "stress hormones, body response" },
  // ---- reward / action selection ----------------------------------------------
  { id: "NACC", name: "Nucleus accumbens", group: "reward", kind: "blob", pos: [-9, 11, -7], radii: [4, 4, 4], neurons: 36, tau: 0.08, rest: 0.03, role: "pleasure and wanting" },
  { id: "VTA", name: "VTA / substantia nigra (dopamine)", group: "reward", kind: "blob", pos: [-4, -17, -14], radii: [3, 3, 3], neurons: 28, tau: 0.06, rest: 0.05, role: "dopamine: 'that was better than expected'" },
  { id: "CAUD", name: "Caudate nucleus", group: "executive", kind: "blob", pos: [-13, 12, 12], radii: [4, 9, 6], neurons: 56, tau: 0.1, rest: 0.04, role: "goal-directed action choice" },
  { id: "PUT", name: "Putamen", group: "motor", kind: "blob", pos: [-25, 4, 2], radii: [5, 9, 7], neurons: 70, tau: 0.09, rest: 0.04, role: "habit and motor selection" },
  { id: "THAL", name: "Thalamus (relay and gate)", group: "executive", kind: "blob", pos: [-10, -18, 8], radii: [7, 11, 7], neurons: 90, tau: 0.05, rest: 0.08, role: "routes everything to cortex" },
  // ---- smell ----------------------------------------------------------------
  { id: "OLF", name: "Olfactory (piriform) cortex", group: "olfactory", kind: "blob", pos: [-18, 10, -22], radii: [5, 6, 3], neurons: 36, tau: 0.08, rest: 0.03, role: "smell, wired straight into emotion and memory" },
  // ---- brainstem ---------------------------------------------------------------
  { id: "SC", name: "Superior colliculus", group: "brainstem", kind: "blob", pos: [-5, -33, -4], radii: [4, 3, 3], neurons: 28, tau: 0.04, rest: 0.03, role: "snap attention to sudden things" },
  { id: "PAG", name: "Periaqueductal grey", group: "brainstem", kind: "blob", pos: [0, -30, -10], radii: [3, 3, 4], neurons: 28, tau: 0.08, rest: 0.03, midline: true, role: "freeze / fight / flee, pain control" },
  { id: "LC", name: "Locus coeruleus (noradrenaline)", group: "brainstem", kind: "blob", pos: [-4, -38, -26], radii: [2, 2, 2], neurons: 16, tau: 0.08, rest: 0.05, role: "alertness: wakes the whole cortex up" },
  { id: "RAPHE", name: "Raphe nuclei (serotonin)", group: "brainstem", kind: "blob", pos: [0, -27, -24], radii: [2, 2, 7], neurons: 24, tau: 0.2, rest: 0.1, midline: true, role: "mood stability and calm" },
  { id: "BF", name: "Basal forebrain (acetylcholine)", group: "brainstem", kind: "blob", pos: [-9, 8, -13], radii: [4, 4, 3], neurons: 26, tau: 0.08, rest: 0.04, role: "attention: sprays acetylcholine over the cortex" },
  { id: "RF", name: "Reticular formation / brainstem", group: "brainstem", kind: "blob", pos: [0, -30, -46], radii: [6, 6, 14], neurons: 70, tau: 0.1, rest: 0.08, midline: true, role: "wakefulness and basic arousal" },
];

export interface NodeInfo {
  index: number;
  node: string;           // "NACC_L"
  region: RegionDef;
  hemi: "L" | "R" | "M";
}

export function buildNodes(): NodeInfo[] {
  const nodes: NodeInfo[] = [];
  for (const region of REGIONS) {
    const hemis: ("L" | "R" | "M")[] = region.midline ? ["M"] : ["L", "R"];
    for (const hemi of hemis) {
      nodes.push({ index: nodes.length, node: hemi === "M" ? region.id : `${region.id}_${hemi}`, region, hemi });
    }
  }
  return nodes;
}

export const regionById = new Map(REGIONS.map((r) => [r.id, r]));
