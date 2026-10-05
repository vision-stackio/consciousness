export function drivesFor(s) {
    const a = s.appraisal;
    const I = s.intensity;
    const d = [];
    const add = (region, amount, lat = 0) => { if (Math.abs(amount) > 0.01)
        d.push({ region, amount, lat }); };
    // ---- 1. the sense organ route ------------------------------------------------
    switch (s.modality) {
        case "vision":
            add("LGN", 0.85 * I);
            add("V1", 0.3 * I);
            add("IT", 0.2 * I);
            add("SC", 0.25 * I * (0.4 + a.novelty));
            add("FFA", 0.65 * a.face * I, 0.3);
            add("MT", 0.15 * I);
            break;
        case "text-read":
            add("LGN", 0.5 * I);
            add("V1", 0.3 * I);
            add("V2V4", 0.25 * I);
            add("WERN", 0.5 * I, -0.4);
            add("TPOLE", 0.2 * I);
            break;
        case "audio":
            add("MGN", 0.85 * I);
            add("A1", 0.3 * I);
            add("SC", 0.2 * I * a.novelty);
            if (s.hasLanguage) {
                add("WERN", 0.45 * I, -0.4);
                add("BROCA", 0.2 * I, -0.4);
                add("TPOLE", 0.15 * I);
            }
            break;
        case "smell":
            add("OLF", 0.9 * I);
            add("AMY", 0.15 * I);
            break;
        case "taste":
            add("INS", 0.55 * I);
            add("OLF", 0.3 * I);
            add("OFC", 0.3 * I);
            add("S1", 0.2 * I);
            break;
        case "touch":
            add("THAL", 0.45 * I);
            add("S1", 0.85 * I);
            add("INS", 0.25 * I);
            break;
        case "pain":
            add("THAL", 0.5 * I);
            add("S1", 0.7 * I);
            add("INS", 0.75 * I);
            add("ACC", 0.8 * I);
            add("PAG", 0.7 * I);
            add("AMY", 0.35 * I);
            add("RF", 0.25 * I);
            add("LC", 0.6 * I);
            add("HYP", 0.5 * I);
            break;
        case "thought":
            add("DLPFC", 0.4 * I);
            add("MPFC", 0.4 * I);
            add("PCC", 0.3 * I);
            add("HIPP", 0.4 * I);
            break;
    }
    // ---- 2. what it MEANS: appraisal -> deep regions ------------------------------
    const g = 0.55 + 0.45 * I; // weak stimuli get less attention
    const r = a.reward * g, t = a.threat * g, l = a.loss * g, an = a.anger * g, di = a.disgust * g;
    const so = a.social * g, nv = a.novelty * g, fa = a.familiarity * g, pn = a.pain * g;
    // reward / pleasure
    add("VTA", 0.95 * r);
    add("NACC", 0.85 * r);
    add("VMPFC", 0.55 * r);
    add("OFC", 0.5 * r);
    add("RAPHE", 0.25 * r);
    // threat / fear
    add("AMY", 1.0 * t, 0.15);
    add("PAG", 0.7 * t);
    add("HYP", 0.6 * t);
    add("LC", 0.8 * t);
    add("INS", 0.4 * t);
    add("SC", 0.4 * t);
    add("ACC", 0.3 * t);
    // loss / sadness: sad = drive up the "low mood" circuit AND dip the reward circuit
    add("SGACC", 0.9 * l);
    add("PCC", 0.5 * l);
    add("INS", 0.4 * l);
    add("AMY", 0.3 * l);
    add("VTA", -0.5 * l);
    add("NACC", -0.4 * l);
    // anger
    add("ACC", 0.8 * an);
    add("HYP", 0.7 * an);
    add("AMY", 0.6 * an);
    add("PAG", 0.3 * an);
    add("PUT", 0.95 * an);
    add("CAUD", 0.55 * an);
    add("PMC", 0.45 * an);
    add("OFC", -0.3 * an);
    // disgust
    add("INS", 1.0 * di);
    add("OLF", 0.4 * di);
    add("PUT", 0.3 * di);
    add("AMY", 0.4 * di);
    add("OFC", 0.3 * di);
    // other minds
    add("TPJ", 0.7 * so);
    add("MPFC", 0.7 * so);
    add("FFA", 0.3 * so * (s.modality === "vision" ? 1 : 0), 0.3);
    // novelty / familiarity
    add("HIPP", 0.8 * nv + 0.5 * fa);
    add("SC", 0.7 * nv);
    add("LC", 0.5 * nv);
    add("ACC", 0.4 * nv);
    add("DLPFC", 0.3 * nv);
    add("AMY", 0.2 * nv);
    add("PHC", 0.5 * fa);
    add("MPFC", 0.2 * fa);
    add("TPOLE", 0.3 * fa);
    // seeing/hearing about pain (empathy) and bodily pain from other senses
    if (s.modality !== "pain") {
        add("ACC", 0.4 * pn);
        add("INS", 0.5 * pn);
        add("S1", 0.15 * pn);
    }
    // attention: anything novel, threatening or strong recruits the basal forebrain
    add("BF", 0.75 * nv + 0.4 * t + 0.25 * I * (s.modality === "thought" ? 0 : 1));
    // general arousal
    add("LC", 0.3 * a.arousal * g);
    add("RF", 0.3 * a.arousal * g);
    return d;
}
/** Sleeping brains still wake for something dangerous. */
export function wakesBrain(s) {
    const a = s.appraisal;
    return s.modality === "pain" || Math.max(a.threat, a.pain, a.anger) * s.intensity > 0.6;
}
