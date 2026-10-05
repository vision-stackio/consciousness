/** Shared by the server (terminal, image analysis, memory) and the browser (simulation, rendering). No DOM, no Node. */
export const ZERO_APPRAISAL = {
    valence: 0, arousal: 0, threat: 0, reward: 0, social: 0, novelty: 0.2,
    disgust: 0, pain: 0, loss: 0, anger: 0, face: 0, familiarity: 0,
};
export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
