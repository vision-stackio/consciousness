/**
 * Vision's senses: camera and microphone, both opt-in.
 *
 * Camera processing (all on this device):
 *   1. Pixel tier (always): motion, presence, lighting, bounding box.
 *   2. Object tier: COCO-SSD (cached by browser after first load → works offline later).
 *   3. Face tier: face-api.js embeddings (same family as the real robot) for multi-person ID.
 * Frames only leave the browser when "share frames with AI" is on.
 */
import type { SenseReading } from "./brain.js";
import { PixelAnalyzer, SightTracker, dominantColor, type Detection, type Sight, type SightEvent } from "./vision.js";
import { FaceId } from "./faceId.js";

type SenseEvent = "motion" | "loud_noise" | "dark" | "bright";
export type VisionMode = "off" | "pixels" | "loading" | "model";

const TF_URL = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";
const COCO_URL = "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js";
const PERSON_LABELS = new Set(["person", "someone"]);
const KNOWN_KEY = "vision.knownPeople.v1";

/** Fallback identity when face-api is unavailable: position + size signature. */
interface KnownPerson {
  name: string;
  samples: { cx: number; size: number; at: number }[];
  hits: number;
}

function loadScript(src: string, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    const t = setTimeout(() => reject(new Error("script timeout")), timeoutMs);
    s.src = src; s.onload = () => { clearTimeout(t); resolve(); }; s.onerror = () => { clearTimeout(t); reject(new Error("script blocked or offline")); };
    document.head.appendChild(s);
  });
}

export class Senses {
  onEvent?: (kind: SenseEvent) => void;
  onSight?: (ev: SightEvent) => void;
  onStatus?: (text: string) => void;
  muted = false; // set while Vision speaks, so it doesn't startle at its own voice

  private camStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private small = document.createElement("canvas");
  private snap = document.createElement("canvas");
  private pixels = new PixelAnalyzer(80, 60);
  private tracker = new SightTracker();
  private timer: ReturnType<typeof setInterval> | null = null;
  private detTimer: ReturnType<typeof setInterval> | null = null;
  private cooldown: Record<SenseEvent, number> = { motion: 0, loud_noise: 0, dark: 0, bright: 0 };
  private brightHist: number[] = [];
  private loudBase = 0.02;
  private model: { detect(v: HTMLVideoElement, max?: number): Promise<{ class: string; score: number; bbox: number[] }[]> } | null = null;
  private modelDets: Detection[] = []; private modelAt = 0; private detecting = false;
  private faceDets: Detection[] = []; private faceAt = 0;
  private lastMotion = { cx: 0.5, at: 0 };
  private focus: { label: string; cx: number; at: number } | null = null;
  private known: KnownPerson[] = [];
  readonly faces = new FaceId();
  mode: VisionMode = "off";
  motion = 0; brightness = 0.5; loudness = 0;
  private modelLoadAttempts = 0;

  constructor(private video: HTMLVideoElement) {
    this.small.width = 80; this.small.height = 60;
    this.loadKnown();
  }

  private loadKnown() {
    try {
      const raw = localStorage.getItem(KNOWN_KEY);
      if (raw) this.known = JSON.parse(raw);
    } catch { this.known = []; }
  }
  private saveKnown() {
    try { localStorage.setItem(KNOWN_KEY, JSON.stringify(this.known)); } catch { /* ignore */ }
  }

  /** List of names Vision currently knows (face embeddings + fallback signatures). */
  knownNames(): string[] {
    const names = new Set([...this.faces.knownNames(), ...this.known.map((k) => k.name)]);
    return [...names];
  }

  /**
   * Teach Vision the name of the person in front of the camera.
   * Prefers face-api 128-d embeddings (multi-sample). Falls back to position/size
   * signature if face models are not loaded yet.
   */
  async teachPerson(name: string): Promise<{ ok: boolean; message: string }> {
    const clean = name.trim().slice(0, 40);
    if (!clean) return { ok: false, message: "need a name" };
    if (!this.camStream || !this.video.videoWidth) {
      return { ok: false, message: "camera is off — turn it on first" };
    }

    // Primary path: deep face embedding
    if (!this.faces.isReady) await this.faces.init();
    if (this.faces.isReady) {
      const r = await this.faces.enroll(this.video, clean);
      if (r.ok) {
        this.focus = { label: clean, cx: 0.5, at: performance.now() };
        // Also keep a coarse signature as backup
        this.teachSignature(clean, 0.5, 0.2);
        return r;
      }
      // If enroll failed (no face), still try signature so teach is not a hard fail
      if (!/no face/i.test(r.message)) return r;
    }

    // Fallback: position/size signature
    const person = this.sights.find((s) => PERSON_LABELS.has(s.label) || this.known.some((k) => k.name === s.label));
    if (!person && !this.personPresent && performance.now() - this.lastMotion.at > 2000) {
      return { ok: false, message: "I don't see a face or person — face the camera with good light" };
    }
    const src = person ?? this.sights[0];
    const cx = src?.cx ?? this.lastMotion.cx;
    const size = src?.size ?? 0.15;
    this.teachSignature(clean, cx, size);
    this.focus = { label: clean, cx, at: performance.now() };
    return {
      ok: true,
      message: this.faces.isReady
        ? `saved a rough signature for ${clean} (no clear face crop — try again with your face centered)`
        : `saved ${clean} with a rough signature (face model still loading — teach again later for embeddings)`,
    };
  }

  private teachSignature(name: string, cx: number, size: number) {
    let entry = this.known.find((k) => k.name.toLowerCase() === name.toLowerCase());
    if (!entry) {
      entry = { name, samples: [], hits: 0 };
      this.known.push(entry);
    }
    entry.samples.push({ cx, size, at: Date.now() });
    if (entry.samples.length > 12) entry.samples = entry.samples.slice(-12);
    entry.hits++;
    this.saveKnown();
  }

  /** Forget one name or all known people (embeddings + signatures). */
  forgetPerson(name?: string) {
    this.faces.forget(name);
    if (!name) { this.known = []; this.saveKnown(); return; }
    this.known = this.known.filter((k) => k.name.toLowerCase() !== name.toLowerCase());
    this.saveKnown();
  }

  /** Try to attach a known name to a person detection (position/size heuristic). */
  private resolvePersonLabel(d: Detection): string {
    if (!PERSON_LABELS.has(d.label)) return d.label;
    if (!this.known.length) return d.label;
    const size = d.w * d.h;
    let best: { name: string; score: number } | null = null;
    for (const k of this.known) {
      if (!k.samples.length) continue;
      // compare to recent samples
      let score = 0;
      for (const s of k.samples) {
        const dcx = Math.abs(s.cx - d.cx);
        const dsz = Math.abs(s.size - size) / Math.max(size, s.size, 0.05);
        const sim = Math.max(0, 1 - dcx * 2.2 - dsz * 0.8);
        score = Math.max(score, sim);
      }
      // prefer frequently taught names slightly
      score += Math.min(0.08, k.hits * 0.01);
      if (!best || score > best.score) best = { name: k.name, score };
    }
    if (best && best.score > 0.55) return best.name;
    return d.label;
  }

  get cameraOn() { return !!this.camStream; }
  get micOn() { return !!this.micStream; }
  get sights(): Sight[] { return this.tracker.current(); }
  get personPresent() {
    const known = new Set([...this.known.map((k) => k.name), ...this.faces.knownNames()]);
    return this.sights.some((s) => PERSON_LABELS.has(s.label) || known.has(s.label));
  }

  async enableCamera(): Promise<void> {
    this.camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false });
    this.video.srcObject = this.camStream;
    await this.video.play().catch(() => {});
    this.pixels.reset(); this.tracker.clear();
    this.mode = "pixels"; this.onStatus?.("watching (pixel mode)");
    this.ensureLoop();
    void this.loadModel();
    void this.faces.init().then((ok) => {
      if (ok) this.onStatus?.("face recognition ready (embeddings)");
    });
  }
  disableCamera() {
    this.camStream?.getTracks().forEach((t) => t.stop());
    this.camStream = null; this.video.srcObject = null; this.motion = 0; this.mode = "off";
    this.tracker.clear(); this.pixels.reset(); this.modelDets = [];
    if (this.detTimer) { clearInterval(this.detTimer); this.detTimer = null; }
    this.onStatus?.("camera off");
  }

  async enableMic(): Promise<void> {
    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    this.audioCtx = new AudioContext();
    this.analyser = this.audioCtx.createAnalyser(); this.analyser.fftSize = 1024;
    this.audioCtx.createMediaStreamSource(this.micStream).connect(this.analyser);
    this.ensureLoop();
  }
  disableMic() {
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null; void this.audioCtx?.close(); this.audioCtx = null; this.analyser = null; this.loudness = 0;
  }

  read(): SenseReading {
    const side = (cx: number) => (cx < 0.38 ? "left" : cx > 0.62 ? "right" : "center") as "left" | "center" | "right";
    return {
      motion: round(this.motion), brightness: round(this.brightness), loudness: round(this.loudness), camera: this.cameraOn, mic: this.micOn,
      seen: this.sights.slice(0, 6).map((s) => ({ label: s.label, side: side(s.cx), near: s.size > 0.12, color: s.color, score: round(s.score), source: "camera" as const })),
      personPresent: this.personPresent,
      visionMode: this.mode === "loading" ? "pixels" : this.mode,
    };
  }

  /** Where Vision should look: known face → person → object → motion → screen center when camera is on. */
  gazeTarget(): { cx: number; label: string } | null {
    const s = this.sights;
    const knownNames = new Set([...this.known.map((k) => k.name), ...this.faces.knownNames()]);
    // something just held up / taught
    if (this.focus && performance.now() - this.focus.at < 4500) {
      const live = s.find((x) => x.label === this.focus!.label) ?? s.find((x) => PERSON_LABELS.has(x.label) || knownNames.has(x.label));
      if (live) return { cx: live.cx, label: live.label };
      return { cx: this.focus.cx, label: this.focus.label };
    }
    const known = s.find((x) => knownNames.has(x.label));
    if (known) return { cx: known.cx, label: known.label };
    const person = s.find((x) => PERSON_LABELS.has(x.label));
    if (person) return { cx: person.cx, label: person.label };
    if (s[0]) return { cx: s[0].cx, label: s[0].label };
    if (performance.now() - this.lastMotion.at < 2000) return { cx: this.lastMotion.cx, label: "movement" };
    // Camera is on: still return a center target so the body/eyes face the screen
    if (this.cameraOn) return { cx: 0.5, label: "screen" };
    return null;
  }

  /** One downscaled JPEG (data URL) of what the camera sees right now, or null. */
  snapshot(): string | null {
    if (!this.camStream || !this.video.videoWidth) return null;
    const w = 320, h = Math.round((320 * this.video.videoHeight) / this.video.videoWidth);
    this.snap.width = w; this.snap.height = h;
    const ctx = this.snap.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(this.video, 0, 0, w, h);
    return this.snap.toDataURL("image/jpeg", 0.6);
  }

  // ---- internals
  private ensureLoop() { if (!this.timer) this.timer = setInterval(() => this.sample(), 200); }

  private fire(kind: SenseEvent, coolMs: number) {
    const now = performance.now();
    if (this.muted || now < this.cooldown[kind]) return;
    this.cooldown[kind] = now + coolMs;
    this.onEvent?.(kind);
  }

  private async loadModel() {
    if (this.model || this.mode === "loading") return;
    if (new URLSearchParams(location.search).has("nomodel")) { this.onStatus?.("pixel mode (object model disabled)"); return; }
    this.mode = "loading"; this.onStatus?.("loading object-detection model…");
    this.modelLoadAttempts++;
    try {
      await loadScript(TF_URL); await loadScript(COCO_URL);
      const coco = (window as any).cocoSsd;
      // lite_mobilenet_v2 is small and caches well; browser Cache Storage keeps it for offline reuse
      this.model = await Promise.race([
        coco.load({ base: "lite_mobilenet_v2" }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("model download timeout")), 60000)),
      ]) as Senses["model"];
      if (!this.camStream) return;
      this.mode = "model"; this.onStatus?.("object model ready (cached for offline reuse)");
      if (!this.detTimer) this.detTimer = setInterval(() => void this.detect(), 400);
    } catch (e) {
      this.mode = this.camStream ? "pixels" : "off";
      this.onStatus?.(`pixel mode only (${(e as Error).message})`);
      // Retry a couple of times — intermittent CDN failures are common
      if (this.modelLoadAttempts < 3 && this.camStream) {
        setTimeout(() => { this.mode = "pixels"; void this.loadModel(); }, 4000 * this.modelLoadAttempts);
      }
    }
  }

  private async detect() {
    if (!this.camStream || this.detecting || this.video.readyState < 2 || !this.video.videoWidth) return;
    this.detecting = true;
    try {
      if (this.model) {
        const preds = await this.model.detect(this.video, 10);
        const vw = this.video.videoWidth, vh = this.video.videoHeight;
        this.modelDets = preds.filter((p) => p.score >= (p.class === "person" ? 0.5 : 0.55)).map((p) => {
          const [x, y, w, h] = p.bbox;
          return { label: p.class, score: p.score, cx: 1 - (x + w / 2) / vw, cy: (y + h / 2) / vh, w: w / vw, h: h / vh };
        });
        this.modelAt = performance.now();
      }
      // Face embeddings (named people) — runs alongside COCO
      if (this.faces.isReady) {
        const hits = await this.faces.detect(this.video);
        this.faceDets = hits.map((h) => ({
          label: h.name,
          score: h.name === "person" ? 0.6 : Math.max(0.55, 1 - h.distance),
          cx: h.cx,
          cy: h.cy,
          w: h.box.w,
          h: h.box.h,
        }));
        this.faceAt = performance.now();
      }
    } catch { /* dropped frame */ } finally { this.detecting = false; }
  }

  private sample() {
    if (this.camStream && this.video.videoWidth) {
      const ctx = this.small.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(this.video, 0, 0, 80, 60);
        const px = ctx.getImageData(0, 0, 80, 60).data;
        const gray = new Uint8Array(80 * 60);
        for (let i = 0, j = 0; i < px.length; i += 4, j++) gray[j] = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
        const st = this.pixels.analyze(gray);
        this.brightness = st.brightness; this.motion = Math.min(1, st.motion * 4);
        if (st.motion > 0.02) this.lastMotion = { cx: 1 - st.cx, at: performance.now() }; // mirrored like the preview
        if (st.motion > 0.12) this.fire("motion", 3500); // sudden big movement
        this.trackBrightness(st.brightness, st.lightingChange);

        // Merge COCO objects + face-api identities + pixel fallback
        let dets: Detection[] = [];
        const now = performance.now();
        if (this.mode === "model" && now - this.modelAt < 1500) {
          dets = this.modelDets.map((d) => {
            if (PERSON_LABELS.has(d.label)) {
              // Prefer face-api name if a face is near this person box
              const face = this.faceDets.find((f) => f.label !== "person" && Math.abs(f.cx - d.cx) < 0.2);
              if (face) return { ...d, label: face.label, score: Math.max(d.score, face.score) };
              const labeled = this.resolvePersonLabel(d);
              return { ...d, label: labeled };
            }
            return { ...d, color: dominantColor(px, 80, 60, d, true) };
          });
        } else if (st.box) {
          dets = [{
            label: this.resolvePersonLabel({ label: "someone", score: 0.5, cx: 1 - st.box.cx, cy: st.box.cy, w: st.box.w, h: st.box.h }),
            score: 0.5, cx: 1 - st.box.cx, cy: st.box.cy, w: st.box.w, h: st.box.h,
          }];
        }
        // Add named faces that COCO might have missed
        if (now - this.faceAt < 1500) {
          for (const f of this.faceDets) {
            if (f.label === "person") continue;
            if (!dets.some((d) => d.label === f.label && Math.abs(d.cx - f.cx) < 0.15)) dets.push(f);
          }
        }
        for (const ev of this.tracker.update(dets, now)) {
          if (ev.type === "appeared" && !PERSON_LABELS.has(ev.label) && (ev.size ?? 0) > 0.07) {
            this.focus = { label: ev.label, cx: ev.cx ?? 0.5, at: now };
          }
          this.onSight?.({ ...ev, source: "camera" });
        }
      }
    }
    if (this.analyser) {
      const buf = new Float32Array(this.analyser.fftSize);
      this.analyser.getFloatTimeDomainData(buf);
      let s = 0; for (const x of buf) s += x * x;
      const rms = Math.sqrt(s / buf.length);
      this.loudness = this.muted ? 0 : Math.min(1, rms * 4);
      if (!this.muted && rms > Math.max(0.15, this.loudBase * 5)) this.fire("loud_noise", 4000);
      this.loudBase = this.loudBase * 0.98 + rms * 0.02; // slow ambient-noise baseline
    }
  }

  private trackBrightness(b: number, lightingChange: boolean) {
    this.brightHist.push(b); if (this.brightHist.length > 10) this.brightHist.shift();
    const old = this.brightHist[0];
    if (this.brightHist.length === 10 || lightingChange) {
      if (old - b > 0.25) { this.fire("dark", 15000); this.brightHist = []; }
      else if (b - old > 0.25) { this.fire("bright", 15000); this.brightHist = []; }
    }
  }
}

const round = (v: number) => Math.round(v * 100) / 100;
