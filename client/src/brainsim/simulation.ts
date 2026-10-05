import { buildNodes, NodeInfo, REGIONS } from "./regions.js";
import { CONTRALATERAL, EDGES } from "./connectome.js";
import { Drive, drivesFor, wakesBrain } from "./perception.js";
import { EmotionReadout, Reader } from "./emotion.js";
import { DecisionMaker, Commit } from "./decision.js";
import { gauss, mulberry32 } from "./rng.js";
import { restingChemistry } from "./chem.js";
import { BrainReport, DecisionEvent, EmotionEvent, EmotionLabel, Neuromodulators, Stimulus, clamp } from "./types.js";

const SYN = 0.6;
const FATIGUE = 0.45;
const sigma = (x: number) => 1 / (1 + Math.exp(-6 * (x - 0.55)));
const invSigma = (a: number) => 0.55 + Math.log(a / (1 - a)) / 6;

interface ActiveStimulus { stim: Stimulus; drives: Drive[]; t: number; id: string }

/** The whole brain: region dynamics + neuromodulators + emotion + decision. No DOM, no Node, runs anywhere. */
export class BrainSim {
  readonly nodes: NodeInfo[] = buildNodes();
  readonly activity: Float32Array;
  readonly rest: Float32Array;
  nm: Neuromodulators = restingChemistry();
  time = 0;
  asleep = false;
  startle = 0;
  readonly emotion = new EmotionReadout();
  readonly decision = new DecisionMaker();
  onEmotion?: (e: EmotionEvent) => void;
  onDecision?: (e: DecisionEvent) => void;
  onEpisode?: (e: { stimulus: Stimulus; peak: EmotionLabel; valence: number; arousal: number }) => void;

  private readonly byRegion = new Map<string, number[]>();
  private readonly edges: { from: number; to: number; w: number }[] = [];
  private readonly noise: Float32Array;
  private readonly bias: Float32Array;
  private readonly tau: Float32Array;
  private readonly input: Float32Array;
  private readonly fatigue: Float32Array;
  private readonly rnd = mulberry32(2024);
  private active: ActiveStimulus[] = [];
  private socialPos = 0;
  private forced: { emotion: EmotionLabel; level: number; until: number } | null = null;
  private episode: { stim: Stimulus; peak: EmotionLabel; peakV: number; val: number; ar: number; end: number } | null = null;
  strongestEdges: { from: number; to: number; strength: number }[] = [];
  private edgeTimer = 0;
  private meanLift = 0;

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
      if (!src || !dst) throw new Error(`bad edge ${from}->${to}`);
      for (const s of src) for (const d of dst) {
        const hs = this.nodes[s].hemi, hd = this.nodes[d].hemi;
        const same = hs === hd || hs === "M" || hd === "M";
        this.edges.push({ from: s, to: d, w: same ? w : w * CONTRALATERAL });
      }
    }
  }

  nodesOf(region: string): number[] { return this.byRegion.get(region) ?? []; }

  /** mean activity ABOVE resting level, 0..1 */
  ex(region: string): number {
    const list = this.byRegion.get(region);
    if (!list) return 0;
    let s = 0;
    for (const i of list) s += clamp((this.activity[i] - this.rest[i]) / (1 - this.rest[i]));
    return s / list.length;
  }
  rate(region: string): number {
    const list = this.byRegion.get(region);
    if (!list) return 0;
    let s = 0;
    for (const i of list) s += this.activity[i];
    return s / list.length;
  }

  private get reader(): Reader { return { ex: (id) => this.ex(id), nm: this.nm, startle: this.startle }; }

  stimulate(stim: Stimulus) {
    if (this.asleep && wakesBrain(stim)) this.wake();
    const a = stim.appraisal;
    this.active.push({ stim, drives: drivesFor(stim), t: 0, id: stim.id });
    this.startle = Math.max(this.startle, clamp(a.novelty * (0.5 + 0.5 * a.arousal) * (0.5 + stim.intensity) + 0.6 * a.threat * stim.intensity));
    this.decision.onStimulus();
    this.finishEpisode();
    this.episode = { stim, peak: "NEUTRAL", peakV: 0, val: 0, ar: 0, end: this.time + stim.duration + 2.5 };
  }

  force(emotion: EmotionLabel, level: number) { this.forced = { emotion, level: clamp(level), until: this.time + 4 }; }

  sleep() { this.asleep = true; }
  wake() { this.asleep = false; }

  reset() {
    this.activity.set(this.rest); this.fatigue.fill(0);
    this.nm = restingChemistry();
    this.active = []; this.startle = 0; this.socialPos = 0; this.forced = null; this.episode = null;
    this.emotion.reset(); this.decision.reset(); this.asleep = false;
  }

  private finishEpisode() {
    if (!this.episode) return;
    const ep = this.episode;
    this.episode = null;
    if (ep.peakV > 0.12) this.onEpisode?.({ stimulus: ep.stim, peak: ep.peak, valence: ep.val, arousal: ep.ar });
  }

  /** advance by dt seconds (internally sub-stepped for stability) */
  step(dt: number) {
    let left = Math.min(dt, 0.25);
    while (left > 1e-6) { const h = Math.min(left, 0.02); this.sub(h); left -= h; }
  }

  private sub(dt: number) {
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

    if (this.forced && this.time > this.forced.until) this.forced = null;

    // --- slow sleep waves + tonic arousal ---
    const slow = this.asleep ? 0.5 + 0.5 * Math.sin(this.time * Math.PI * 1.6) : 0;
    const gain = (this.asleep ? 0.45 : 1) * (1 + 0.3 * (this.nm.noradrenaline - 0.1) + 0.2 * (this.nm.adrenaline - 0.05)) * (1 - 0.3 * (this.nm.melatonin - 0.1));
    const nm = this.nm;

    const a = this.activity;
    const next = new Float32Array(n);
    // recurrent drive from deviations above rest
    const syn = new Float32Array(n);
    for (const e of this.edges) syn[e.to] += e.w * (a[e.from] - this.rest[e.from]);
    // global inhibition: the more of the brain is active, the harder it is to recruit more
    let mean = 0;
    for (let i = 0; i < n; i++) mean += Math.max(0, a[i] - this.rest[i]);
    const globalInh = 1.6 * (mean / n) * (0.6 + 1.2 * this.nm.gaba);
    this.meanLift = mean / n;

    for (let i = 0; i < n; i++) {
      const id = this.nodes[i].region.id;
      this.noise[i] += (-this.noise[i] * dt / 0.25) + 0.08 * Math.sqrt(dt) * gauss(this.rnd);
      let x = this.bias[i] + gain * (syn[i] * SYN + input[i]) + this.noise[i] - globalInh - FATIGUE * this.fatigue[i];
      // neuromodulator effects
      switch (id) {
        case "NACC": x += 0.3 * (nm.dopamine - 0.1) + 0.15 * (nm.oxytocin - 0.1) + 0.15 * (nm.endorphin - 0.1); break;
        case "VMPFC": x += 0.2 * (nm.dopamine - 0.1) + 0.2 * (nm.serotonin - 0.4) - 0.2 * (nm.cortisol - 0.1); break;
        case "DLPFC": case "CAUD": x += 0.2 * (nm.dopamine - 0.1); break;
        case "AMY": x += 0.25 * (nm.cortisol - 0.1) - 0.3 * (nm.serotonin - 0.4) - 0.25 * (nm.oxytocin - 0.1) + 0.15 * (nm.noradrenaline - 0.1); break;
        case "HIPP": x += -0.15 * (nm.cortisol - 0.1) + 0.2 * (nm.acetylcholine - 0.15); break;
        case "MPFC": case "TPJ": x += 0.15 * (nm.oxytocin - 0.1); break;
        case "V1": case "V2V4": case "A1": case "IT": x += 0.2 * (nm.acetylcholine - 0.15); break;
        case "M1": case "PMC": case "PPC": x += 0.15 * (nm.adrenaline - 0.05); break;
        case "S1": x += 0.2 * (nm.acetylcholine - 0.15) - 0.25 * (nm.endorphin - 0.1); break;
        case "RAPHE": x += this.asleep ? -0.3 : 0.12 * (this.socialPos); break;
        case "LC": x += (this.asleep ? -0.5 : 0) - 0.3 * (nm.melatonin - 0.1); break;
        case "RF": x += (this.asleep ? -0.4 : 0) - 0.3 * (nm.melatonin - 0.1); break;
        case "ACC": case "INS": x -= 0.2 * (nm.endorphin - 0.1); break;
      }
      if (this.asleep && this.nodes[i].region.kind === "shell") x += 0.25 * slow - 0.1;
      if (this.asleep && id === "HIPP") x += 0.12 * Math.max(0, Math.sin(this.time * 0.9 + i));
      if (this.forced) x += this.forceDrive(id, this.forced) ;
      const target = sigma(x);
      next[i] = a[i] + (target - a[i]) * (1 - Math.exp(-dt / this.tau[i]));
      // slow adaptation: sustained firing tires a region out, which also stops runaway excitation
      this.fatigue[i] += ((a[i] - this.rest[i]) - this.fatigue[i]) * (1 - Math.exp(-dt / 2.2));
    }
    a.set(next);

    // --- neuromodulators follow their source nuclei, at their own (slow) pace ---
    const follow = (cur: number, target: number, tau: number) => cur + (target - cur) * (1 - Math.exp(-dt / tau));
    nm.dopamine = follow(nm.dopamine, clamp(0.1 + 1.0 * this.ex("VTA")), 0.6);
    nm.noradrenaline = follow(nm.noradrenaline, this.asleep ? 0.02 : clamp(0.1 + 1.0 * this.ex("LC")), 1.0);
    nm.serotonin = follow(nm.serotonin, this.asleep ? 0.25 : clamp(0.4 + 0.9 * this.ex("RAPHE") - 0.25 * this.ex("SGACC")), 6);
    nm.cortisol = follow(nm.cortisol, clamp(0.1 + 1.3 * this.ex("HYP") * (0.4 + this.ex("AMY"))), 18);
    nm.oxytocin = follow(nm.oxytocin, clamp(0.1 + 0.9 * this.socialPos), 6);
    nm.adrenaline = follow(nm.adrenaline, clamp(0.05 + 1.4 * this.ex("HYP") * (0.3 + this.ex("AMY")) + 0.35 * this.ex("LC")), 2.5);
    nm.endorphin = follow(nm.endorphin, clamp(0.1 + 1.0 * this.ex("PAG") * 1.5 + 0.3 * this.ex("NACC")), 7);
    nm.acetylcholine = follow(nm.acetylcholine, this.asleep ? 0.08 : clamp(0.15 + 1.2 * this.ex("BF")), 1.5);
    nm.gaba = follow(nm.gaba, clamp(0.3 + 2.4 * this.meanLift + (this.asleep ? 0.25 : 0)), 3);
    nm.melatonin = follow(nm.melatonin, this.asleep ? 0.9 : 0.1, 8);
    this.startle *= Math.exp(-dt / 0.8);

    // --- readouts ---
    const prevEmotion = this.emotion.current;
    this.emotion.update(this.reader, dt);
    if (this.emotion.current !== prevEmotion) {
      this.onEmotion?.({ emotion: this.emotion.current, intensity: this.emotion.intensity, because: this.emotion.because, time: this.time });
    }
    const commit: Commit | null = this.decision.update(this.reader, dt);
    if (commit) this.onDecision?.({ ...commit, time: this.time });

    if (this.episode) {
      const ep = this.episode;
      const em = this.emotion.current;
      const strength = em === "NEUTRAL" || em === "CALM" ? 0 : this.emotion.intensity;
      if (strength > ep.peakV) { ep.peakV = strength; ep.peak = em; ep.val = this.emotion.valence(this.reader); ep.ar = clamp(this.ex("LC") + 0.3 * this.startle); }
      if (this.time > ep.end) this.finishEpisode();
    }

    this.edgeTimer += dt;
    if (this.edgeTimer > 0.12) { this.edgeTimer = 0; this.refreshEdges(); }
  }

  private forceDrive(id: string, f: { emotion: EmotionLabel; level: number }): number {
    const L = f.level;
    const m: Partial<Record<EmotionLabel, Record<string, number>>> = {
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

  private refreshEdges() {
    const list: { from: number; to: number; strength: number }[] = [];
    for (const e of this.edges) {
      if (e.w <= 0) continue;
      const s = (this.activity[e.from] - this.rest[e.from]) * e.w;
      if (s > 0.12 && this.activity[e.to] > this.rest[e.to] + 0.03) list.push({ from: e.from, to: e.to, strength: s });
    }
    list.sort((p, q) => q.strength - p.strength);
    this.strongestEdges = list.slice(0, 40);
  }

  report(topN = 12): BrainReport {
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

  regionNames() { return REGIONS.map((r) => r.id); }
}
