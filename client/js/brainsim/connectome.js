/**
 * Directed, weighted pathways between regions (+ excitatory, - inhibitory).
 * Weights are small on purpose: activity is driven by stimuli and then
 * *spreads* along these pathways, which is what makes the glow travel.
 * Same-side links use the full weight, cross-hemisphere links are 35 %.
 *
 * Plasticity: each edge has a base weight (anatomical prior) and a live weight
 * that slowly changes with experience (Hebbian + dopamine-modulated).
 * This is the core of the brain developing its own intelligence.
 */
export const EDGES = [
    // vision
    ["LGN", "V1", 0.9], ["V1", "V2V4", 0.8], ["V2V4", "MT", 0.55], ["V2V4", "IT", 0.7], ["V2V4", "FFA", 0.55],
    ["IT", "FFA", 0.35], ["MT", "PPC", 0.55], ["PPC", "DLPFC", 0.35], ["IT", "TPOLE", 0.4], ["IT", "AMY", 0.35],
    ["FFA", "AMY", 0.35], ["FFA", "TPJ", 0.4], ["FFA", "MPFC", 0.2], ["V1", "SC", 0.2], ["SC", "PPC", 0.3], ["SC", "THAL", 0.25],
    ["IT", "HIPP", 0.25], ["IT", "PHC", 0.3], ["MT", "SC", 0.2],
    // hearing + language
    ["MGN", "A1", 0.9], ["A1", "WERN", 0.7], ["WERN", "BROCA", 0.55], ["WERN", "TPJ", 0.35], ["WERN", "DLPFC", 0.3],
    ["A1", "AMY", 0.3], ["WERN", "TPOLE", 0.35], ["BROCA", "PMC", 0.35], ["BROCA", "M1", 0.25], ["A1", "SC", 0.25],
    // touch + pain
    ["THAL", "S1", 0.7], ["S1", "M1", 0.3], ["S1", "INS", 0.55], ["S1", "PPC", 0.3], ["INS", "ACC", 0.45], ["ACC", "INS", 0.3],
    ["THAL", "INS", 0.4], ["PAG", "THAL", 0.2], ["S1", "ACC", 0.25],
    // smell + taste (smell bypasses the thalamus)
    ["OLF", "AMY", 0.65], ["OLF", "OFC", 0.55], ["OLF", "HIPP", 0.3], ["OLF", "INS", 0.4],
    // threat circuit
    ["AMY", "HYP", 0.7], ["AMY", "PAG", 0.7], ["AMY", "LC", 0.55], ["AMY", "INS", 0.35], ["AMY", "ACC", 0.35],
    ["AMY", "HIPP", 0.35], ["AMY", "SC", 0.2], ["AMY", "NACC", 0.15], ["INS", "AMY", 0.4], ["HYP", "PAG", 0.35],
    ["PAG", "RF", 0.4], ["LC", "AMY", 0.25], ["HIPP", "AMY", 0.2], ["ACC", "AMY", 0.15],
    // emotion regulation (top-down brakes)
    ["VMPFC", "AMY", -0.5], ["OFC", "AMY", -0.3], ["DLPFC", "AMY", -0.25], ["MPFC", "AMY", -0.2],
    // reward circuit
    ["VTA", "NACC", 0.9], ["VTA", "VMPFC", 0.5], ["VTA", "OFC", 0.35], ["NACC", "VTA", 0.25], ["OFC", "NACC", 0.5],
    ["VMPFC", "NACC", 0.5], ["AMY", "OFC", 0.2], ["HIPP", "NACC", 0.25], ["NACC", "CAUD", 0.3], ["OFC", "VMPFC", 0.35],
    ["VMPFC", "RAPHE", 0.3], ["RAPHE", "VMPFC", 0.2],
    // sadness / rumination
    ["SGACC", "PCC", 0.35], ["PCC", "SGACC", 0.3], ["SGACC", "AMY", 0.15], ["SGACC", "HYP", 0.25], ["SGACC", "INS", 0.2],
    ["SGACC", "VTA", -0.3],
    // action selection
    ["DLPFC", "CAUD", 0.55], ["CAUD", "THAL", 0.4], ["PUT", "THAL", 0.4], ["THAL", "PMC", 0.55], ["PMC", "M1", 0.8],
    ["M1", "PUT", 0.25], ["M1", "CB", 0.4], ["CB", "THAL", 0.3], ["PPC", "PMC", 0.45], ["DLPFC", "PMC", 0.45],
    ["ACC", "DLPFC", 0.45], ["DLPFC", "ACC", 0.2], ["ACC", "PMC", 0.2], ["PUT", "M1", 0.15],
    // memory + default mode
    ["HIPP", "PHC", 0.5], ["PHC", "HIPP", 0.5], ["HIPP", "PCC", 0.35], ["PCC", "HIPP", 0.3], ["HIPP", "VMPFC", 0.3],
    ["PCC", "MPFC", 0.5], ["MPFC", "PCC", 0.5], ["TPJ", "MPFC", 0.35], ["TPJ", "PCC", 0.25], ["TPOLE", "AMY", 0.2],
    ["TPOLE", "OFC", 0.25], ["HIPP", "TPOLE", 0.2],
    // arousal system
    ["RF", "THAL", 0.5], ["LC", "THAL", 0.25], ["HYP", "RF", 0.3], ["HYP", "LC", 0.25], ["RF", "LC", 0.2],
    ["THAL", "DLPFC", 0.3], ["THAL", "ACC", 0.25],
    // attention system (basal forebrain, acetylcholine)
    ["BF", "HIPP", 0.45], ["BF", "ACC", 0.3], ["BF", "DLPFC", 0.3], ["BF", "PPC", 0.3], ["BF", "V1", 0.25], ["BF", "A1", 0.25],
    ["BF", "AMY", 0.15], ["RF", "BF", 0.3], ["AMY", "BF", 0.25], ["ACC", "BF", 0.2],
];
export const CONTRALATERAL = 0.35;
