/**
 * The Brain panel: a rotating 3D brain whose regions light up as Vision feels things, the emotion that is
 * read out of that activity, and all ten hormones / neuromodulators. Enlarge it with the button (or Esc to close).
 */
import type { BrainRenderer } from "./brainview.js";
import type { Limbic } from "./limbic.js";
import { CHEMS } from "./brainsim/chem.js";
import { GROUP_COLOR, GROUP_LABEL, type Group } from "./brainsim/regions.js";
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
    $("brInstinct").innerHTML = `instinct <b>${d.current.toLowerCase()}</b>${d.current === "OBSERVE" ? "" : ` · ${pct(d.confidence)}%`}${d.conflict > 0.5 ? " · hesitating" : ""}`;

    const gc = this.renderer.groupColour();
    for (const [g, li] of this.legendRows) {
      const m = gc.get(g) ?? 0, dot = li.firstElementChild as HTMLElement, c = GROUP_COLOR[g];
      dot.style.background = m > 0.12 ? c : "#4a4a4a";
      dot.style.boxShadow = m > 0.12 ? `0 0 ${Math.round(4 + 8 * m)}px ${c}` : "none";
      li.style.color = m > 0.12 ? "#e6e6e6" : "";
    }
  }
}
