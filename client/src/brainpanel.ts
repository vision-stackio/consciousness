/**
 * The Brain panel: a rotating 3D brain whose regions light up as Vision feels things, the emotion that is
 * read out of that activity, and all ten hormones / neuromodulators. Enlarge it with the button (or Esc to close).
 */
import type { BrainRenderer } from "./brainview.js";
import type { Limbic } from "./limbic.js";
import { CHEMS } from "./brainsim/chem.js";
import { GROUP_COLOR, GROUP_LABEL, DIVISION_LABEL, divisionNeuronTotals, type Group } from "./brainsim/regions.js";
import type { EmotionLabel } from "./brainsim/types.js";

export const EMOTION_COLOR: Record<EmotionLabel, string> = {
  NEUTRAL: "#b0b0b0", CALM: "#7bdff2", HAPPY: "#ffd166", EXCITED: "#ff9f1c", CURIOUS: "#4cc9f0", SURPRISED: "#f15bb5",
  FEARFUL: "#b388ff", ANGRY: "#ff3b3b", DISGUSTED: "#9ccc3c", SAD: "#5c7cfa", PAIN: "#ff6b35",
};
const REST_WHY: Record<string, string> = { NEUTRAL: "at rest, waiting for something to happen", CALM: "settled; serotonin is high" };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pct = (v: number) => `${Math.round(v * 100)}`;

export class BrainPanel {
  private chemRows = new Map<string, { row: HTMLElement; fill: HTMLElement; val: HTMLElement }>();
  private legendRows = new Map<Group, HTMLLIElement>();
  private lastEmotion = "";
  private lastWhy = "";

  constructor(private limbic: Limbic, private renderer: BrainRenderer) {
    const grid = $("chemGrid");
    for (const c of CHEMS) {
      const row = document.createElement("div");
      row.className = "chem"; row.style.setProperty("--c", c.color); row.title = `${c.label}: ${c.role}`;
      row.innerHTML = `<b class="ring"></b><span class="n">${c.label}</span><span class="t"><i></i></span><span class="v">0</span>`;
      grid.appendChild(row);
      this.chemRows.set(c.id, { row, fill: row.querySelector("i") as HTMLElement, val: row.querySelector(".v") as HTMLElement });
    }
    const leg = $("brainLegend");
    for (const g of Object.keys(GROUP_COLOR) as Group[]) {
      const li = document.createElement("li");
      li.innerHTML = `<i></i>${GROUP_LABEL[g]}`;
      leg.appendChild(li); this.legendRows.set(g, li);
    }
    const sec = $("brSec");
    $("brainExpand").addEventListener("click", () => this.setBig(!sec.classList.contains("big")));
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && sec.classList.contains("big")) { this.setBig(false); e.stopImmediatePropagation(); } // Esc closes the big brain first; it must not also trigger the E-STOP
    });
    window.addEventListener("keydown", (e) => {
      const el = e.target as HTMLElement | null;
      if (!sec.classList.contains("big") || (el && /input|textarea|select/i.test(el.tagName))) return;
      if (e.key.toLowerCase() === "l") renderer.showLabels = !renderer.showLabels;
      if (e.key.toLowerCase() === "e") renderer.showPaths = !renderer.showPaths;
    });
  }

  private setBig(on: boolean) {
    $("brSec").classList.toggle("big", on);
    this.renderer.showLabels = on;   // region names are only readable when the brain is large
    $("brainExpand").textContent = on ? "Close" : "Enlarge";
  }

  /** ~8 Hz DOM refresh (the canvas itself draws every frame) */
  update() {
    const st = this.limbic.state(), sim = this.limbic.sim;
    const color = EMOTION_COLOR[st.emotion];
    $("brSec").style.setProperty("--accent", color);
    document.documentElement.style.setProperty("--emo", color);   // the Mind panel wears the same colour
    const word = st.emotion.toLowerCase();
    if (word !== this.lastEmotion) { $("brEmo").textContent = word; this.lastEmotion = word; }
    const why = st.emotion === "NEUTRAL" || st.emotion === "CALM" ? REST_WHY[st.emotion] : `because ${st.because || "the activity pattern"}`;
    if (why !== this.lastWhy) { $("brWhy").textContent = why; this.lastWhy = why; }
    $("brMeter").style.width = `${Math.round(st.intensity * 100)}%`;
    $("brInt").textContent = `${Math.round(st.intensity * 100)}%`;
    $("brState").textContent = st.asleep ? "asleep · slow waves" : "awake";

    for (const c of CHEMS) {
      const v = st.nm[c.id], r = this.chemRows.get(c.id)!;
      r.fill.style.width = `${pct(v)}%`; r.val.textContent = pct(v);
      r.row.classList.toggle("hot", v - c.base > 0.12);   // released: the ring lights up in its colour
    }
    const d = sim.decision;
    const moodV = sim.emotion.moodValence ?? 0;
    const moodA = sim.emotion.moodArousal ?? 0.3;
    const moodTag = moodV > 0.2 ? "upbeat" : moodV < -0.2 ? "low" : "neutral";
    $("brInstinct").innerHTML = `instinct <b>${d.current.toLowerCase()}</b>${d.current === "OBSERVE" ? "" : ` · ${pct(d.confidence)}%`}${d.conflict > 0.5 ? " · hesitating" : ""} · mood ${moodTag}`;

    // CNS division neuron totals (relative weights matching real ratios)
    const divEl = document.getElementById("brDivisions");
    if (divEl) {
      const tot = divisionNeuronTotals();
      const sum = tot.cerebrum + tot.cerebellum + tot.brainstem || 1;
      divEl.innerHTML = (["cerebrum", "cerebellum", "brainstem"] as const).map((k) => {
        const pctN = Math.round(100 * tot[k] / sum);
        return `<span title="${DIVISION_LABEL[k]}">${k} ${pctN}%</span>`;
      }).join(" · ");
    }

    // Live predictive-processing architecture panel
    const gen = sim.generative;
    const pe = gen.lastPE;
    const unc = gen.uncertainty;
    const epi = gen.epistemicValue(d.current);
    $("archUnc").textContent = pct(unc) + "%";
    $("archPE").textContent = pct(pe) + "%";
    $("archEpi").textContent = pct(epi) + "%";

    const nodes = $("archFlow").querySelectorAll(".arch-node");
    const hasStim = sim.activeStimulusLabel != null;
    // Approximate live activity from available signals
    const levels: Record<string, number> = {
      percept: hasStim || pe > 0.08 ? 0.7 + 0.3 * pe : 0.1,
      model: 0.3 + 0.5 * unc,
      predict: 0.25 + 0.4 * unc,
      pe: pe,
      need: Math.max(st.nm.dopamine, st.nm.cortisol, st.nm.oxytocin, st.nm.noradrenaline) * 1.2,
      act: d.current === "OBSERVE" ? 0.15 : 0.55 + 0.4 * d.confidence,
      decide: d.current === "OBSERVE" ? 0.1 : 0.7 + 0.3 * d.confidence,
    };
    nodes.forEach((el) => {
      const n = (el as HTMLElement).dataset.n || "";
      const v = levels[n] ?? 0;
      el.classList.remove("hot", "hot-pe", "hot-decide");
      if (n === "pe" && v > 0.18) el.classList.add("hot-pe");
      else if (n === "decide" && v > 0.35) el.classList.add("hot-decide");
      else if (v > 0.28) el.classList.add("hot");
    });

    const gc = this.renderer.groupColour();
    for (const [g, li] of this.legendRows) {
      const m = gc.get(g) ?? 0, dot = li.firstElementChild as HTMLElement, c = GROUP_COLOR[g];
      dot.style.background = m > 0.12 ? c : "#4a4a4a";
      dot.style.boxShadow = m > 0.12 ? `0 0 ${Math.round(4 + 8 * m)}px ${c}` : "none";
      li.style.color = m > 0.12 ? "#e6e6e6" : "";
    }
  }
}
