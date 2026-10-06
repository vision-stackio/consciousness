/**
 * Face identity using face-api.js (same family as the real Vision robot stack).
 * Loads tiny face detector + recognition net from CDN; stores 128-d embeddings
 * in localStorage for multi-person matching by cosine similarity.
 *
 * Offline: once models are cached by the browser, subsequent loads work offline.
 * If face-api fails to load, callers fall back to the lightweight signature path.
 */

const FACEAPI_URL = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";
const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model";
const STORE_KEY = "vision.faceEmbeddings.v1";
const MATCH_THRESHOLD = 0.48; // cosine distance; lower = stricter (typical 0.4–0.6)

export interface FaceHit {
  name: string;
  distance: number;
  box: { x: number; y: number; w: number; h: number }; // normalized 0..1 in video space
  cx: number;
  cy: number;
}

interface StoredPerson {
  name: string;
  descriptors: number[][]; // several 128-d vectors
  hits: number;
  updatedAt: number;
}

function loadScript(src: string, timeoutMs = 25000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    const t = setTimeout(() => reject(new Error("face-api script timeout")), timeoutMs);
    s.src = src;
    s.onload = () => { clearTimeout(t); resolve(); };
    s.onerror = () => { clearTimeout(t); reject(new Error("face-api script blocked or offline")); };
    document.head.appendChild(s);
  });
}

function cosineDistance(a: number[] | Float32Array, b: number[] | Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
  return d;
}

function meanDescriptor(list: number[][]): number[] {
  const dim = list[0]?.length ?? 128;
  const out = new Array(dim).fill(0);
  for (const d of list) for (let i = 0; i < dim; i++) out[i] += d[i];
  for (let i = 0; i < dim; i++) out[i] /= list.length;
  return out;
}

export class FaceId {
  private ready = false;
  private loading: Promise<boolean> | null = null;
  private people: StoredPerson[] = [];
  private api: any = null;

  constructor() {
    this.loadStore();
  }

  get isReady() { return this.ready; }
  knownNames(): string[] { return this.people.map((p) => p.name); }

  private loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) this.people = JSON.parse(raw);
    } catch { this.people = []; }
  }

  private saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.people)); } catch { /* quota */ }
  }

  /** Load face-api models (cached by browser after first success). */
  async init(): Promise<boolean> {
    if (this.ready) return true;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        await loadScript(FACEAPI_URL);
        const fa = (window as any).faceapi;
        if (!fa) throw new Error("faceapi global missing");
        // Prefer vladmandic models (well maintained); fall back to classic paths if needed
        await Promise.all([
          fa.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          fa.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          fa.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
        this.api = fa;
        this.ready = true;
        return true;
      } catch (e) {
        console.warn("[FaceId] init failed:", (e as Error).message);
        this.ready = false;
        return false;
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  /**
   * Detect faces in a video/canvas element and match against enrolled people.
   * Returns hits with names when distance is below threshold.
   */
  async detect(input: HTMLVideoElement | HTMLCanvasElement): Promise<FaceHit[]> {
    if (!this.ready || !this.api) return [];
    const fa = this.api;
    try {
      const opts = new fa.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 });
      const results = await fa
        .detectAllFaces(input, opts)
        .withFaceLandmarks()
        .withFaceDescriptors();
      if (!results?.length) return [];

      const vw = (input as HTMLVideoElement).videoWidth || input.width || 1;
      const vh = (input as HTMLVideoElement).videoHeight || input.height || 1;
      const hits: FaceHit[] = [];

      for (const r of results) {
        const box = r.detection.box;
        const desc = Array.from(r.descriptor as Float32Array) as number[];
        const { name, distance } = this.match(desc);
        // Mirror cx to match the preview convention used elsewhere in the sandbox
        const cxRaw = (box.x + box.width / 2) / vw;
        const cx = 1 - cxRaw;
        const cy = (box.y + box.height / 2) / vh;
        hits.push({
          name: name ?? "person",
          distance,
          box: { x: box.x / vw, y: box.y / vh, w: box.width / vw, h: box.height / vh },
          cx,
          cy,
        });
      }
      return hits;
    } catch {
      return [];
    }
  }

  private match(descriptor: number[]): { name: string | null; distance: number } {
    let bestName: string | null = null;
    let bestDist = Infinity;
    for (const p of this.people) {
      if (!p.descriptors.length) continue;
      // Compare to mean of enrolled descriptors (stable) and to each sample
      const mean = meanDescriptor(p.descriptors);
      let d = cosineDistance(descriptor, mean);
      for (const sample of p.descriptors) {
        d = Math.min(d, cosineDistance(descriptor, sample));
      }
      if (d < bestDist) {
        bestDist = d;
        bestName = p.name;
      }
    }
    if (bestName && bestDist <= MATCH_THRESHOLD) return { name: bestName, distance: bestDist };
    return { name: null, distance: bestDist };
  }

  /**
   * Enrol / update a person from the current frame.
   * Captures all detected faces; if multiple, uses the largest.
   * Call several times from different angles for accuracy.
   */
  async enroll(input: HTMLVideoElement | HTMLCanvasElement, name: string): Promise<{ ok: boolean; message: string }> {
    const clean = name.trim().slice(0, 40);
    if (!clean) return { ok: false, message: "need a name" };
    if (!this.ready) {
      const ok = await this.init();
      if (!ok) return { ok: false, message: "face model not available — check network once so models can cache" };
    }
    const fa = this.api;
    try {
      const opts = new fa.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 });
      const results = await fa
        .detectAllFaces(input, opts)
        .withFaceLandmarks()
        .withFaceDescriptors();
      if (!results?.length) {
        return { ok: false, message: "no face found — face the camera with good light" };
      }
      // Largest face
      results.sort((a: any, b: any) => b.detection.box.width * b.detection.box.height - a.detection.box.width * a.detection.box.height);
      const desc = Array.from(results[0].descriptor as Float32Array) as number[];

      let person = this.people.find((p) => p.name.toLowerCase() === clean.toLowerCase());
      if (!person) {
        person = { name: clean, descriptors: [], hits: 0, updatedAt: Date.now() };
        this.people.push(person);
      }
      person.descriptors.push(desc);
      if (person.descriptors.length > 10) person.descriptors = person.descriptors.slice(-10);
      person.hits++;
      person.updatedAt = Date.now();
      this.saveStore();
      return {
        ok: true,
        message: person.descriptors.length < 3
          ? `saved ${clean} (${person.descriptors.length}/3 samples — a couple more angles helps)`
          : `saved ${clean} (${person.descriptors.length} samples) — recognition ready`,
      };
    } catch (e) {
      return { ok: false, message: `enrol failed: ${(e as Error).message}` };
    }
  }

  forget(name?: string) {
    if (!name) this.people = [];
    else this.people = this.people.filter((p) => p.name.toLowerCase() !== name.toLowerCase());
    this.saveStore();
  }

  /** Continuous improvement: if a matched face is very confident, optionally refresh embedding (slow drift). */
  reinforce(name: string, descriptor: number[]) {
    const p = this.people.find((x) => x.name === name);
    if (!p) return;
    p.descriptors.push(descriptor);
    if (p.descriptors.length > 10) p.descriptors = p.descriptors.slice(-10);
    p.hits++;
    p.updatedAt = Date.now();
    this.saveStore();
  }
}
