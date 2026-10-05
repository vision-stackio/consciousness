/**
 * Vision's senses: camera and microphone, both opt-in.
 *
 * Camera processing, two tiers, all on this device:
 *   1. Pixel tier (always): motion, presence, lighting, where in the view. No downloads.
 *   2. Model tier (if it loads): COCO-SSD object detection in the browser, so Vision can
 *      name what it sees (person, cup, cat, phone...) and know where.
 * Frames only leave the browser when "share frames with AI" is on, one downscaled JPEG per thought.
 */
import type { SenseReading } from "./brain.js";
import { PixelAnalyzer, SightTracker, dominantColor, type Detection, type Sight, type SightEvent } from "./vision.js";

type SenseEvent = "motion" | "loud_noise" | "dark" | "bright";
export type VisionMode = "off" | "pixels" | "loading" | "model";

const TF_URL = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";
const COCO_URL = "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js";
const PERSON_LABELS = new Set(["person", "someone"]);

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
  private lastMotion = { cx: 0.5, at: 0 };
  private focus: { label: string; cx: number; at: number } | null = null; // something being held up to the camera
  mode: VisionMode = "off";
  motion = 0; brightness = 0.5; loudness = 0;

  constructor(private video: HTMLVideoElement) { this.small.width = 80; this.small.height = 60; }

  get cameraOn() { return !!this.camStream; }
  get micOn() { return !!this.micStream; }
  get sights(): Sight[] { return this.tracker.current(); }
  get personPresent() { return this.sights.some((s) => PERSON_LABELS.has(s.label)); }

  async enableCamera(): Promise<void> {
    this.camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false });
    this.video.srcObject = this.camStream;
    await this.video.play().catch(() => {});
    this.pixels.reset(); this.tracker.clear();
    this.mode = "pixels"; this.onStatus?.("watching (pixel mode)");
    this.ensureLoop();
    void this.loadModel();
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

  /** Where Vision should look: a person if there is one, else the biggest thing, else recent motion. */
  gazeTarget(): { cx: number; label: string } | null {
    const s = this.sights;
    // something just held up to the camera gets his attention first (for a few seconds)
    if (this.focus && performance.now() - this.focus.at < 4500) {
      const live = s.find((x) => x.label === this.focus!.label);
      if (live) return { cx: live.cx, label: live.label };
    }
    const person = s.find((x) => PERSON_LABELS.has(x.label));
    if (person) return { cx: person.cx, label: person.label };
    if (s[0]) return { cx: s[0].cx, label: s[0].label };
    if (performance.now() - this.lastMotion.at < 1500) return { cx: this.lastMotion.cx, label: "movement" };
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
    try {
      await loadScript(TF_URL); await loadScript(COCO_URL);
      const coco = (window as any).cocoSsd;
      this.model = await Promise.race([
        coco.load({ base: "lite_mobilenet_v2" }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("model download timeout")), 60000)),
      ]) as Senses["model"];
      if (!this.camStream) return; // camera was turned off while loading
      this.mode = "model"; this.onStatus?.("object model ready: I can name what I see");
      this.detTimer = setInterval(() => void this.detect(), 450);
    } catch (e) {
      this.mode = this.camStream ? "pixels" : "off";
      this.onStatus?.(`pixel mode only (${(e as Error).message})`);
    }
  }

  private async detect() {
    if (!this.model || !this.camStream || this.detecting || this.video.readyState < 2 || !this.video.videoWidth) return;
    this.detecting = true;
    try {
      const preds = await this.model.detect(this.video, 10);
      const vw = this.video.videoWidth, vh = this.video.videoHeight;
      this.modelDets = preds.filter((p) => p.score >= (p.class === "person" ? 0.55 : 0.6)).map((p) => {
        const [x, y, w, h] = p.bbox;
        return { label: p.class, score: p.score, cx: 1 - (x + w / 2) / vw, cy: (y + h / 2) / vh, w: w / vw, h: h / vh }; // cx mirrored to match the preview
      });
      this.modelAt = performance.now();
    } catch { /* a dropped frame is fine */ } finally { this.detecting = false; }
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

        // detections: the model if it is running and fresh, otherwise "someone" from pixels
        let dets: Detection[];
        if (this.mode === "model" && performance.now() - this.modelAt < 1500)
          dets = this.modelDets.map((d) => (d.label === "person" ? d : { ...d, color: dominantColor(px, 80, 60, d, true) })); // "a red cup", not just "a cup"
        else dets = st.box && this.mode !== "model" ? [{ label: "someone", score: 0.5, cx: 1 - st.box.cx, cy: st.box.cy, w: st.box.w, h: st.box.h }] : [];
        for (const ev of this.tracker.update(dets, performance.now())) {
          if (ev.type === "appeared" && !PERSON_LABELS.has(ev.label) && (ev.size ?? 0) > 0.07) this.focus = { label: ev.label, cx: ev.cx ?? 0.5, at: performance.now() };
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
