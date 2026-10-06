import { buildNodes, REGIONS } from "./regions.js";
import { CONTRALATERAL, EDGES } from "./connectome.js";
import { drivesFor, wakesBrain } from "./perception.js";
import { EmotionReadout } from "./emotion.js";
import { DecisionMaker } from "./decision.js";
import { GenerativeModel } from "./predictive.js";
import { gauss, mulberry32 } from "./rng.js";
import { restingChemistry } from "./chem.js";
import { clamp } from "./types.js";
const SYN = 0.6;
const FATIGUE = 0.45;
const sigma = (x) => 1 / (1 + Math.exp(-6 * (x - 0.55)));
const invSigma = (a) => 0.55 + Math.log(a / (1 - a)) / 6;
/**
 * The whole brain: region dynamics + neuromodulators + emotion + decision + learning
 * + generative / predictive-processing layer.
 * No DOM, no Node, runs anywhere.
 *
 * Learning (the source of "own intelligence"):
 * - Plastic synaptic weights on the connectome (Hebbian + dopamine).
 * - Learned action values and region→action gains inside DecisionMaker.
 * - Dopamine driven by reward prediction error (RPE) instead of pure VTA readout.
 * - Generative model of sensory causes updated by prediction error;
 *   epistemic (information-seeking) value biases action selection.
 */
export class BrainSim {
    nodes = buildNodes();
    activity;
    rest;
    nm = restingChemistry();
    time = 0;
    asleep = false;
    startle = 0;
    emotion = new EmotionReadout();
    decision = new DecisionMaker();
    /** Generative model of expected sensory causes (predictive processing). */
    generative = new GenerativeModel();
    onEmotion;
    onDecision;
    onEpisode;
    byRegion = new Map();
    edges = [];
    noise;
    bias;
    tau;
    input;
    fatigue;
    rnd = mulberry32(2024);
    active = [];
    socialPos = 0;
    forced = null;
    episode = null;
    strongestEdges = [];
    edgeTimer = 0;
    meanLift = 0;
    // --- learning state ---
    expectedValue = 0; // running prediction of reward
    lastOutcome = 0; // most recent experienced valence/reward
    rpe = 0; // reward prediction error (drives dopamine + learning)
    plasticityTimer = 0;
    constructor() {
        const n = this.nodes.length;
        this.activity = new Float32Array(n);
        this.rest = new Float32Array(n);
        this.noise = new Float32Array(n);
        this.bias = new Float32Array(n);
        this.tau = new Float32Array(n);
        this.input = new Float32Array(n);
        this.fatigue = new Float32Array(n);
        for (const node of this.nodes) {
            const i = node.index;
            this.rest[i] = node.region.rest;
            this.activity[i] = node.region.rest;
            this.bias[i] = invSigma(node.region.rest);
            this.tau[i] = node.region.tau;
            const list = this.byRegion.get(node.region.id) ?? [];
            list.push(i);
            this.byRegion.set(node.region.id, list);
        }
        for (const [from, to, w] of EDGES) {
            const src = this.byRegion.get(from), dst = this.byRegion.get(to);
            if (!src || !dst)
                throw new Error(`bad edge ${from}->${to}`);
            for (const s of src)
                for (const d of dst) {
                    const hs = this.nodes[s].hemi, hd = this.nodes[d].hemi;
                    const same = hs === hd || hs === "M" || hd === "M";
                    const ww = same ? w : w * CONTRALATERAL;
                    this.edges.push({ from: s, to: d, base: ww, w: ww });
                }
        }
        // Wire generative model into the decision maker for epistemic value
        this.decision.setGenerativeModel(this.generative);
    }
    nodesOf(region) { return this.byRegion.get(region) ?? []; }
    /** mean activity ABOVE resting level, 0..1 */
    ex(region) {
        const list = this.byRegion.get(region);
        if (!list)
            return 0;
        let s = 0;
        for (const i of list)
            s += clamp((this.activity[i] - this.rest[i]) / (1 - this.rest[i]));
        return s / list.length;
    }
    rate(region) {
        const list = this.byRegion.get(region);
        if (!list)
            return 0;
        let s = 0;
        for (const i of list)
            s += this.activity[i];
        return s / list.length;
    }
    get reader() { return { ex: (id) => this.ex(id), nm: this.nm, startle: this.startle }; }
    stimulate(stim) {
        if (this.asleep && wakesBrain(stim))
            this.wake();
        const a = stim.appraisal;
        this.active.push({ stim, drives: drivesFor(stim), t: 0, id: stim.id });
        this.startle = Math.max(this.startle, clamp(a.novelty * (0.5 + 0.5 * a.arousal) * (0.5 + stim.intensity) + 0.6 * a.threat * stim.intensity));
        this.decision.onStimulus();
        this.finishEpisode();
        this.episode = { stim, peak: "NEUTRAL", peakV: 0, val: 0, ar: 0, end: this.time + stim.duration + 2.5 };
        // Predictive-processing: update generative model with this observation
        // (prediction error drives belief update and later epistemic value)
        this.generative.observe(stim, this.reader);
        // Immediate outcome signal for learning (valence + reward - threat - pain ...)
        const outcome = clamp(0.6 * a.valence + 0.5 * a.reward - 0.7 * a.threat - 0.6 * a.pain - 0.4 * a.loss - 0.3 * a.disgust + 0.2 * a.social, -1, 1) * stim.intensity;
        this.lastOutcome = outcome;
        // RPE = actual - expected
        this.rpe = outcome - this.expectedValue;
        this.expectedValue += 0.15 * this.rpe; // slow update of prediction
        // Teach the decision system
        this.decision.learn(this.rpe, 0.1);
    }
    force(emotion, level) { this.forced = { emotion, level: clamp(level), until: this.time + 4 }; }
    sleep() { this.asleep = true; }
    wake() { this.asleep = false; }
    reset() {
        this.activity.set(this.rest);
        this.fatigue.fill(0);
        this.nm = restingChemistry();
        this.active = [];
        this.startle = 0;
        this.socialPos = 0;
        this.forced = null;
        this.episode = null;
        this.emotion.reset();
        this.decision.reset();
        this.generative.reset();
        this.asleep = false;
        this.expectedValue = 0;
        this.lastOutcome = 0;
        this.rpe = 0;
        // restore anatomical priors
        for (const e of this.edges)
            e.w = e.base;
    }
    finishEpisode() {
        if (!this.episode)
            return;
        const ep = this.episode;
        this.episode = null;
        if (ep.peakV > 0.12)
            this.onEpisode?.({ stimulus: ep.stim, peak: ep.peak, valence: ep.val, arousal: ep.ar });
    }
    /** advance by dt seconds (internally sub-stepped for stability) */
    step(dt) {
        let left = Math.min(dt, 0.25);
        while (left > 1e-6) {
            const h = Math.min(left, 0.02);
            this.sub(h);
            left -= h;
        }
    }
    sub(dt) {
        const n = this.nodes.length;
        this.time += dt;
        const input = this.input;
        input.fill(0);
        // --- stimulus envelopes ---
        let socialPos = 0;
        for (const s of this.active) {
            s.t += dt;
            const att = Math.min(1, s.t / 0.25);
            const rel = s.t > s.stim.duration ? Math.max(0, 1 - (s.t - s.stim.duration) / 3.0) : 1;
            const env = att * rel * (this.asleep ? 0.15 : 1);
            for (const d of s.drives) {
                for (const i of this.byRegion.get(d.region) ?? []) {
                    const h = this.nodes[i].hemi;
                    const lat = d.lat ?? 0;
                    const side = h === "M" ? 1 : h === "R" ? 1 + lat * 0.6 : 1 - lat * 0.6;
                    input[i] += d.amount * env * side;
                }
            }
            socialPos = Math.max(socialPos, s.stim.appraisal.social * Math.max(0, s.stim.appraisal.valence, 0.9 * s.stim.appraisal.reward) * env);
        }
        this.active = this.active.filter((s) => s.t < s.stim.duration + 3.0);
        this.socialPos += (socialPos - this.socialPos) * (1 - Math.exp(-dt / 1.5));
        if (this.forced && this.time > this.forced.until)
            this.forced = null;
        // --- slow sleep waves + tonic arousal ---
        const slow = this.asleep ? 0.5 + 0.5 * Math.sin(this.time * Math.PI * 1.6) : 0;
        const gain = (this.asleep ? 0.45 : 1) * (1 + 0.3 * (this.nm.noradrenaline - 0.1) + 0.2 * (this.nm.adrenaline - 0.05)) * (1 - 0.3 * (this.nm.melatonin - 0.1));
        const nm = this.nm;
        const a = this.activity;
        const next = new Float32Array(n);
        // recurrent drive from deviations above rest (uses plastic weights)
        const syn = new Float32Array(n);
        for (const e of this.edges)
            syn[e.to] += e.w * (a[e.from] - this.rest[e.from]);
        // global inhibition: the more of the brain is active, the harder it is to recruit more
        let mean = 0;
        for (let i = 0; i < n; i++)
            mean += Math.max(0, a[i] - this.rest[i]);
        const globalInh = 1.6 * (mean / n) * (0.6 + 1.2 * this.nm.gaba);
        this.meanLift = mean / n;
        for (let i = 0; i < n; i++) {
            const id = this.nodes[i].region.id;
            this.noise[i] += (-this.noise[i] * dt / 0.25) + 0.08 * Math.sqrt(dt) * gauss(this.rnd);
            let x = this.bias[i] + gain * (syn[i] * SYN + input[i]) + this.noise[i] - globalInh - FATIGUE * this.fatigue[i];
            // neuromodulator effects
            switch (id) {
                case "NACC":
                    x += 0.3 * (nm.dopamine - 0.1) + 0.15 * (nm.oxytocin - 0.1) + 0.15 * (nm.endorphin - 0.1);
                    break;
                case "VMPFC":
                    x += 0.2 * (nm.dopamine - 0.1) + 0.2 * (nm.serotonin - 0.4) - 0.2 * (nm.cortisol - 0.1);
                    break;
                case "DLPFC":
                case "CAUD":
                    x += 0.2 * (nm.dopamine - 0.1);
                    break;
                case "AMY":
                    x += 0.25 * (nm.cortisol - 0.1) - 0.3 * (nm.serotonin - 0.4) - 0.25 * (nm.oxytocin - 0.1) + 0.15 * (nm.noradrenaline - 0.1);
                    break;
                case "HIPP":
                    x += -0.15 * (nm.cortisol - 0.1) + 0.2 * (nm.acetylcholine - 0.15);
                    break;
                case "MPFC":
                case "TPJ":
                    x += 0.15 * (nm.oxytocin - 0.1);
                    break;
                case "V1":
                case "V2V4":
                case "A1":
                case "IT":
                    x += 0.2 * (nm.acetylcholine - 0.15);
                    break;
                case "M1":
                case "PMC":
                case "PPC":
                    x += 0.15 * (nm.adrenaline - 0.05);
                    break;
                case "S1":
                    x += 0.2 * (nm.acetylcholine - 0.15) - 0.25 * (nm.endorphin - 0.1);
                    break;
                case "RAPHE":
                    x += this.asleep ? -0.3 : 0.12 * (this.socialPos);
                    break;
                case "LC":
                    x += (this.asleep ? -0.5 : 0) - 0.3 * (nm.melatonin - 0.1);
                    break;
                case "RF":
                    x += (this.asleep ? -0.4 : 0) - 0.3 * (nm.melatonin - 0.1);
                    break;
                case "ACC":
                case "INS":
                    x -= 0.2 * (nm.endorphin - 0.1);
                    break;
            }
            if (this.asleep && this.nodes[i].region.kind === "shell")
                x += 0.25 * slow - 0.1;
            if (this.asleep && id === "HIPP")
                x += 0.12 * Math.max(0, Math.sin(this.time * 0.9 + i));
            if (this.forced)
                x += this.forceDrive(id, this.forced);
            const target = sigma(x);
            next[i] = a[i] + (target - a[i]) * (1 - Math.exp(-dt / this.tau[i]));
            // slow adaptation: sustained firing tires a region out
            this.fatigue[i] += ((a[i] - this.rest[i]) - this.fatigue[i]) * (1 - Math.exp(-dt / 2.2));
        }
        a.set(next);
        // --- neuromodulators (with realistic cross-talk) ---
        // Dopamine: primarily RPE + residual VTA. Cortisol and high serotonin suppress it.
        const follow = (cur, target, tau) => cur + (target - cur) * (1 - Math.exp(-dt / tau));
        const dopTarget = clamp(0.1 + 0.85 * Math.max(0, this.rpe) + 0.35 * this.ex("VTA")
            - 0.25 * Math.max(0, nm.cortisol - 0.2)
            - 0.12 * Math.max(0, nm.serotonin - 0.55)
            + 0.1 * Math.max(0, -this.rpe) * 0.25, 0, 1);
        nm.dopamine = follow(nm.dopamine, dopTarget, 0.45);
        // Noradrenaline: LC + novelty/startle, reduced by high melatonin and GABA
        nm.noradrenaline = follow(nm.noradrenaline, this.asleep ? 0.02 : clamp(0.1 + 1.0 * this.ex("LC") + 0.35 * this.startle - 0.2 * Math.max(0, nm.melatonin - 0.2)), 1.0);
        // Serotonin: Raphe, social safety, suppressed by subgenual ACC (rumination) and high cortisol
        nm.serotonin = follow(nm.serotonin, this.asleep ? 0.25 : clamp(0.4 + 0.9 * this.ex("RAPHE") - 0.25 * this.ex("SGACC") - 0.2 * Math.max(0, nm.cortisol - 0.25) + 0.15 * this.socialPos), 6);
        // Cortisol: slow stress axis. Builds with amygdala + hypothalamus, cleared slowly
        nm.cortisol = follow(nm.cortisol, clamp(0.1 + 1.3 * this.ex("HYP") * (0.4 + this.ex("AMY")) - 0.15 * Math.max(0, nm.oxytocin - 0.2)), 18);
        // Oxytocin: social contact + gentle positive valence
        nm.oxytocin = follow(nm.oxytocin, clamp(0.1 + 0.9 * this.socialPos + 0.15 * Math.max(0, this.lastOutcome)), 6);
        // Adrenaline: fast sympathetic surge
        nm.adrenaline = follow(nm.adrenaline, clamp(0.05 + 1.4 * this.ex("HYP") * (0.3 + this.ex("AMY")) + 0.35 * this.ex("LC") + 0.4 * this.startle), 2.5);
        // Endorphin: pain + reward relief
        nm.endorphin = follow(nm.endorphin, clamp(0.1 + 1.0 * this.ex("PAG") * 1.5 + 0.3 * this.ex("NACC") + 0.2 * Math.max(0, this.rpe)), 7);
        // Acetylcholine: attention / sensory gain. Higher when BF active or curiosity high
        nm.acetylcholine = follow(nm.acetylcholine, this.asleep ? 0.08 : clamp(0.15 + 1.2 * this.ex("BF") + 0.2 * Math.max(0, this.rpe) * 0.5), 1.5);
        // GABA: global brake, rises with mean cortical activity and sleep
        nm.gaba = follow(nm.gaba, clamp(0.3 + 2.4 * this.meanLift + (this.asleep ? 0.25 : 0)), 3);
        // Melatonin: sleep drive
        nm.melatonin = follow(nm.melatonin, this.asleep ? 0.9 : 0.1, 8);
        this.startle *= Math.exp(-dt / 0.8);
        // decay RPE slowly so a single event does not dominate forever
        this.rpe *= Math.exp(-dt / 2.5);
        // --- synaptic plasticity (slow, dopamine-gated Hebbian) ---
        this.plasticityTimer += dt;
        if (this.plasticityTimer > 0.15 && !this.asleep) {
            this.plasticityTimer = 0;
            this.applyPlasticity(0.15);
        }
        // during sleep: gentle consolidation toward useful weights + soft replay
        if (this.asleep && Math.random() < 0.02) {
            this.applyPlasticity(0.4); // stronger update while "replaying"
        }
        // Generative model: slow decay of uncertainty when nothing new is happening
        if (this.active.length === 0)
            this.generative.idle(dt);
        // --- readouts ---
        const prevEmotion = this.emotion.current;
        this.emotion.update(this.reader, dt);
        if (this.emotion.current !== prevEmotion) {
            this.onEmotion?.({ emotion: this.emotion.current, intensity: this.emotion.intensity, because: this.emotion.because, time: this.time });
        }
        const commit = this.decision.update(this.reader, dt);
        if (commit)
            this.onDecision?.({ ...commit, time: this.time });
        if (this.episode) {
            const ep = this.episode;
            const em = this.emotion.current;
            const strength = em === "NEUTRAL" || em === "CALM" ? 0 : this.emotion.intensity;
            if (strength > ep.peakV) {
                ep.peakV = strength;
                ep.peak = em;
                ep.val = this.emotion.valence(this.reader);
                ep.ar = clamp(this.ex("LC") + 0.3 * this.startle);
            }
            if (this.time > ep.end)
                this.finishEpisode();
        }
        this.edgeTimer += dt;
        if (this.edgeTimer > 0.12) {
            this.edgeTimer = 0;
            this.refreshEdges();
        }
    }
    /**
     * Three-factor plasticity:
     * Δw ∝ pre × post × dopamine
     * Soft pull back toward the anatomical base weight so the network cannot drift arbitrarily far.
     */
    applyPlasticity(dtScale) {
        const dop = this.nm.dopamine - 0.1;
        const lr = 0.012 * dtScale;
        const homeo = 0.004 * dtScale; // homeostatic pull to base
        for (const e of this.edges) {
            if (e.base < 0)
                continue; // do not plasticize strong inhibitory anatomical brakes for now
            const pre = Math.max(0, this.activity[e.from] - this.rest[e.from]);
            const post = Math.max(0, this.activity[e.to] - this.rest[e.to]);
            if (pre < 0.04 || post < 0.04) {
                // weak activity → slow decay toward base
                e.w += (e.base - e.w) * homeo * 0.5;
                continue;
            }
            const hebb = pre * post * (0.6 + 1.8 * Math.max(0, dop)); // dopamine gates LTP
            const ltd = pre * (1 - post) * 0.25 * Math.max(0, -dop); // mild LTD when dopamine low
            e.w += lr * (hebb - ltd) + (e.base - e.w) * homeo;
            // keep weights in a healthy range relative to their base
            const maxW = Math.abs(e.base) * 2.8 + 0.15;
            const minW = Math.abs(e.base) * 0.15;
            e.w = clamp(e.w, minW, maxW);
        }
    }
    forceDrive(id, f) {
        const L = f.level;
        const m = {
            HAPPY: { NACC: 0.9, VTA: 0.9, VMPFC: 0.5, OFC: 0.4 },
            EXCITED: { NACC: 0.9, VTA: 0.9, LC: 0.8, VMPFC: 0.3 },
            FEARFUL: { AMY: 1, PAG: 0.7, LC: 0.8, HYP: 0.6 },
            ANGRY: { ACC: 0.8, HYP: 0.7, AMY: 0.6, PUT: 0.5 },
            DISGUSTED: { INS: 1, OLF: 0.4, PUT: 0.3 },
            SAD: { SGACC: 0.9, PCC: 0.5, INS: 0.3 },
            PAIN: { S1: 0.7, ACC: 0.8, INS: 0.7, PAG: 0.4 },
            CURIOUS: { ACC: 0.6, SC: 0.6, HIPP: 0.6, VTA: 0.4 },
            SURPRISED: { SC: 0.8, LC: 0.8, AMY: 0.3 },
        };
        return (m[f.emotion]?.[id] ?? 0) * L;
    }
    refreshEdges() {
        const list = [];
        for (const e of this.edges) {
            if (e.w <= 0)
                continue;
            const s = (this.activity[e.from] - this.rest[e.from]) * e.w;
            if (s > 0.12 && this.activity[e.to] > this.rest[e.to] + 0.03)
                list.push({ from: e.from, to: e.to, strength: s });
        }
        list.sort((p, q) => q.strength - p.strength);
        this.strongestEdges = list.slice(0, 40);
    }
    report(topN = 12) {
        const top = this.nodes.map((n) => ({ node: n.node, name: n.region.name, rate: this.activity[n.index] }))
            .sort((p, q) => q.rate - p.rate).slice(0, topN);
        const sc = this.active[this.active.length - 1];
        return {
            time: this.time, asleep: this.asleep,
            emotion: this.emotion.current, intensity: this.emotion.intensity,
            valence: this.emotion.valence(this.reader), arousal: clamp(this.ex("LC") + 0.3 * this.startle),
            decision: this.decision.current, decisionConfidence: this.decision.confidence,
            neuromodulators: { ...this.nm }, topRegions: top, activeStimulus: sc ? sc.stim.label : null,
        };
    }
    /** Expose learning diagnostics + generative model state */
    learningState() {
        return {
            rpe: this.rpe,
            expectedValue: this.expectedValue,
            lastOutcome: this.lastOutcome,
            decision: this.decision.learnedState(),
            generative: this.generative.snapshot(),
        };
    }
    /**
     * External reward signal from the high-level mind.
     * Lets consequences of actual behaviour (play succeeded, was scolded, etc.)
     * teach the neural decision layer, keeping both levels of learning aligned.
     */
    externalOutcome(outcome) {
        const o = clamp(outcome, -1, 1);
        this.lastOutcome = o;
        this.rpe = o - this.expectedValue;
        this.expectedValue += 0.12 * this.rpe;
        this.decision.learn(this.rpe, 0.12);
    }
    /** Durable learning that should survive page reloads. */
    exportLearning() {
        // Only store edges that have drifted meaningfully from their base
        const plastic = [];
        for (let i = 0; i < this.edges.length; i++) {
            const e = this.edges[i];
            if (Math.abs(e.w - e.base) > 0.02)
                plastic.push({ i, w: e.w });
        }
        return {
            expectedValue: this.expectedValue,
            decision: this.decision.exportLearning(),
            edges: plastic,
        };
    }
    importLearning(data) {
        if (!data)
            return;
        if (typeof data.expectedValue === "number")
            this.expectedValue = clamp(data.expectedValue, -1, 1);
        this.decision.importLearning(data.decision ?? null);
        if (Array.isArray(data.edges)) {
            for (const { i, w } of data.edges) {
                if (i >= 0 && i < this.edges.length && typeof w === "number") {
                    const e = this.edges[i];
                    const maxW = Math.abs(e.base) * 2.8 + 0.15;
                    const minW = Math.abs(e.base) * 0.15;
                    e.w = clamp(w, minW, maxW);
                }
            }
        }
    }
    regionNames() { return REGIONS.map((r) => r.id); }
    /** Label of the most recent active stimulus (for UI). */
    get activeStimulusLabel() {
        const sc = this.active[this.active.length - 1];
        return sc ? sc.stim.label : null;
    }
}
