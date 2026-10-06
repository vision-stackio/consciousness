/**
 * Vision's visual processing, pure math (no DOM) so it can be tested headlessly.
 *
 *   PixelAnalyzer : works on any webcam with no downloads. Motion, presence (difference
 *                   from a slowly-learned background), lighting changes, a bounding box.
 *                   It can say "something is there", not "what".
 *   SightTracker  : turns noisy per-frame detections (from the pixel analyzer or from an
 *                   object-detection model) into stable events: appeared / left.
 */
export class PixelAnalyzer {
    w;
    h;
    motionThr;
    presenceThr;
    minPresence;
    prev = null;
    bg = null;
    constructor(w = 80, h = 60, motionThr = 18, presenceThr = 28, minPresence = 0.015) {
        this.w = w;
        this.h = h;
        this.motionThr = motionThr;
        this.presenceThr = presenceThr;
        this.minPresence = minPresence;
    }
    reset() { this.prev = null; this.bg = null; }
    /** gray: w*h luma values 0..255 */
    analyze(gray) {
        const { w, h } = this, n = w * h;
        let sum = 0;
        for (let i = 0; i < n; i++)
            sum += gray[i];
        const brightness = sum / n / 255;
        if (!this.bg || !this.prev) {
            this.bg = Float32Array.from(gray);
            this.prev = Uint8Array.from(gray);
            return { brightness, motion: 0, cx: 0.5, cy: 0.5, presence: 0, box: null, lightingChange: false };
        }
        let mc = 0, msx = 0, msy = 0, pc = 0, x0 = w, x1 = -1, y0 = h, y1 = -1;
        const present = new Uint8Array(n);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                if (Math.abs(gray[i] - this.prev[i]) > this.motionThr) {
                    mc++;
                    msx += x;
                    msy += y;
                }
                if (Math.abs(gray[i] - this.bg[i]) > this.presenceThr) {
                    pc++;
                    present[i] = 1;
                    if (x < x0)
                        x0 = x;
                    if (x > x1)
                        x1 = x;
                    if (y < y0)
                        y0 = y;
                    if (y > y1)
                        y1 = y;
                }
            }
        }
        const presence = pc / n, motion = mc / n;
        // The whole picture changed (lights on/off, camera bumped): relearn the background instead of calling it "someone".
        if (presence > 0.6) {
            this.bg = Float32Array.from(gray);
            this.prev = Uint8Array.from(gray);
            return { brightness, motion, cx: 0.5, cy: 0.5, presence: 0, box: null, lightingChange: true };
        }
        // Learn the background slowly, but never inside the region where someone is standing still.
        for (let i = 0; i < n; i++)
            if (!present[i])
                this.bg[i] += (gray[i] - this.bg[i]) * 0.02;
        this.prev = Uint8Array.from(gray);
        const box = presence >= this.minPresence && x1 >= x0
            ? { cx: (x0 + x1 + 1) / 2 / w, cy: (y0 + y1 + 1) / 2 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h } : null;
        return { brightness, motion, cx: mc ? msx / mc / w : 0.5, cy: mc ? msy / mc / h : 0.5, presence, box, lightingChange: false };
    }
}
export class SightTracker {
    confirm;
    absentMs;
    st = new Map();
    constructor(confirm = 2, absentMs = 3500) {
        this.confirm = confirm;
        this.absentMs = absentMs;
    }
    sideOf = (cx) => (cx < 0.38 ? "left" : cx > 0.62 ? "right" : "center");
    update(dets, now) {
        const events = [];
        const best = new Map();
        for (const d of dets) {
            const b = best.get(d.label);
            if (!b || d.w * d.h > b.w * b.h)
                best.set(d.label, d);
        }
        for (const [label, d] of best) {
            const s = this.st.get(label) ?? { hits: 0, present: false, lastSeen: now, firstSeen: now, sight: { ...d, size: d.w * d.h } };
            s.hits++;
            s.lastSeen = now;
            s.sight = { ...d, size: d.w * d.h };
            if (!s.present && s.hits >= this.confirm) {
                s.present = true;
                s.firstSeen = now;
                events.push({ type: "appeared", label, side: this.sideOf(d.cx), near: s.sight.size > 0.12, size: s.sight.size, cx: d.cx, color: d.color, source: d.source, score: d.score });
            }
            this.st.set(label, s);
        }
        for (const [label, s] of this.st) {
            if (best.has(label))
                continue;
            s.hits = 0;
            if (s.present && now - s.lastSeen > this.absentMs) {
                s.present = false;
                events.push({ type: "left", label, side: this.sideOf(s.sight.cx), near: false, durationMs: now - s.firstSeen });
            }
        }
        return events;
    }
    current() {
        return [...this.st.values()].filter((s) => s.present).map((s) => s.sight).sort((a, b) => b.size - a.size);
    }
    sideOfSight(s) { return this.sideOf(s.cx); }
    clear() { this.st.clear(); }
}
// ------------------------------------------------------------------ colour ---
/** Name a colour in plain words. */
export function colorName(r, g, b) {
    const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, d = mx - mn;
    const v = mx, sat = mx === 0 ? 0 : d / mx;
    if (v < 0.16)
        return "black";
    if (sat < 0.18)
        return v > 0.78 ? "white" : v > 0.32 ? "gray" : "black";
    let h = 0;
    if (d > 0) {
        if (mx === r / 255)
            h = ((g - b) / 255 / d) % 6;
        else if (mx === g / 255)
            h = (b - r) / 255 / d + 2;
        else
            h = (r - g) / 255 / d + 4;
        h *= 60;
        if (h < 0)
            h += 360;
    }
    if (h < 15 || h >= 340)
        return sat < 0.45 && v > 0.7 ? "pink" : "red";
    if (h < 45)
        return v < 0.66 ? "brown" : "orange";
    if (h < 70)
        return v < 0.5 ? "brown" : "yellow";
    if (h < 170)
        return "green";
    if (h < 200)
        return "teal";
    if (h < 255)
        return "blue";
    if (h < 290)
        return "purple";
    return "pink";
}
/** The main colour inside a detection box (centre 60% of it, majority vote). Box is in display (mirrored) coordinates. */
export function dominantColor(rgba, w, h, box, mirrored = true) {
    const cx = mirrored ? 1 - box.cx : box.cx;
    const x0 = Math.max(0, Math.floor((cx - box.w * 0.3) * w)), x1 = Math.min(w - 1, Math.ceil((cx + box.w * 0.3) * w));
    const y0 = Math.max(0, Math.floor((box.cy - box.h * 0.3) * h)), y1 = Math.min(h - 1, Math.ceil((box.cy + box.h * 0.3) * h));
    const votes = new Map();
    for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
            const i = (y * w + x) * 4, name = colorName(rgba[i], rgba[i + 1], rgba[i + 2]);
            votes.set(name, (votes.get(name) ?? 0) + 1);
        }
    let best, n = 0;
    for (const [k, c] of votes)
        if (c > n) {
            best = k;
            n = c;
        }
    return best;
}
const norm180 = (a) => (((a % 360) + 540) % 360) - 180;
/** "toy_red" -> "red toy", random gift ids -> "new toy", landmarks keep their name. */
export function arenaLabel(id) {
    const m = id.match(/^toy_([a-z]+)$/);
    if (m && ["red", "blue", "green", "yellow", "orange", "purple", "pink"].includes(m[1]))
        return `${m[1]} toy`;
    if (/^toy_/.test(id))
        return "new toy";
    if (/tree|plant/i.test(id))
        return "tree";
    if (/rock|stone/i.test(id))
        return "rock";
    if (/box|crate/i.test(id))
        return "box";
    if (/ball/i.test(id))
        return "ball";
    return id.replace(/_/g, " ");
}
/**
 * Synthetic vision of the 3D arena: projects objects into image-like detections
 * with distance-dependent confidence, angular size, and depth ordering.
 * Feeds the same SightTracker path as the camera (not a second neural net).
 */
export function worldDetections(p, objs, o = { fov: 130, range: 24 }) {
    const candidates = [];
    for (const ob of objs) {
        const dx = ob.x - p.x, dz = ob.z - p.z, dist = Math.hypot(dx, dz) / p.unit;
        if (dist > o.range || dist < 0.25)
            continue;
        const bearing = norm180((Math.atan2(dx, dz) * 180) / Math.PI - p.headingDeg);
        if (Math.abs(bearing) > o.fov / 2)
            continue;
        const ang = Math.min(0.55, Math.max(0.035, (2.4 * ob.r) / (dist * p.unit + 0.01)));
        const axis = 1 - Math.abs(bearing) / (o.fov / 2);
        const score = Math.max(0.35, Math.min(0.98, (1 - dist / o.range) * 0.75 + axis * 0.25));
        const cy = 0.55 + Math.min(0.25, dist * 0.015);
        candidates.push({
            label: ob.label, score, cx: 0.5 + bearing / o.fov, cy, w: ang, h: ang * 1.05, source: "arena", dist,
        });
    }
    candidates.sort((a, b) => a.dist - b.dist);
    const out = [];
    for (const c of candidates) {
        const occluded = out.some((n) => Math.abs(n.cx - c.cx) < (n.w + c.w) * 0.35 && (n.w * n.h) > (c.w * c.h) * 1.2);
        if (occluded && c.dist > 4)
            continue;
        const { dist: _d, ...det } = c;
        out.push(det);
    }
    return out;
}
