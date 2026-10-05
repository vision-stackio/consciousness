import { HULL, buildCallosum } from "./brainsim/geometry.js";
import { GROUP_COLOR } from "./brainsim/regions.js";
import { CHEMS } from "./brainsim/chem.js";
const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgba = (h, a) => { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; };
/** a hollow glowing ring: chemicals read as drifting droplets, clearly different from the round neurons */
function ringSprite(color) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, rgba(color, 0.3));
    grd.addColorStop(0.42, rgba(color, 0.14));
    grd.addColorStop(0.6, rgba(color, 1));
    grd.addColorStop(0.76, rgba(color, 0.35));
    grd.addColorStop(1, rgba(color, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return c;
}
function haloSprite(color) {
    const c = document.createElement("canvas");
    c.width = c.height = 96;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(48, 48, 0, 48, 48, 48);
    grd.addColorStop(0, rgba(color, 0.95));
    grd.addColorStop(0.3, rgba(color, 0.4));
    grd.addColorStop(1, rgba(color, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, 96, 96);
    return c;
}
const tmp1 = new Float32Array(1), tmp2 = new Float32Array(1);
const R = 100; // radius (mm) the camera frames, so the brain never changes size while it turns
const CAM = 430; // camera distance for the perspective effect
function sprite(color) {
    const c = document.createElement("canvas");
    c.width = c.height = 48;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(24, 24, 0, 24, 24, 24);
    grd.addColorStop(0, color);
    grd.addColorStop(0.28, color);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 48, 48);
    return c;
}
export class BrainRenderer {
    sim;
    cloud;
    fibres;
    showLabels = false;
    showPaths = true;
    autoRotate = true;
    views = [];
    glow;
    sprites = new Map();
    white = sprite("#ffffff");
    gray = sprite("#d4d4d4");
    /** 0 = grey, 1 = fully coloured; rises fast when a region fires, fades back slowly */
    mix;
    nodeGroup;
    nodeColor;
    cx;
    cy;
    cz; // neurons, centred
    ncx;
    ncy;
    ncz; // node centroids, centred
    clock = 0;
    rings = CHEMS.map((c) => ringSprite(c.color));
    halos = CHEMS.map((c) => haloSprite(c.color));
    drops = [];
    spawnAcc = CHEMS.map(() => 0);
    srcNodes = [];
    tgtNodes = [];
    cortexNeurons = [];
    o = { x: 0, y: 0, near: 0, f: 1 };
    nx;
    ny;
    nz; // surface normals
    haze = [];
    hazeSprite = haloSprite("#ffffff");
    blob;
    callosum = buildCallosum(90);
    rip; // per-neuron slow rhythm
    nodeRGB; // current colour of each region (grey -> system colour)
    groupRGB;
    quality = 1; // fraction of cortex points drawn; adapts to keep the frame rate up
    frameMs = 10;
    frameNo = 0;
    fx2;
    seed = 2463534242;
    lut = (() => { const t = new Uint8ClampedArray(1024); for (let i = 0; i < 1024; i++)
        t[i] = 255 * (1 - Math.exp(-1.1 * (i / 256))); return t; })();
    constructor(sim, cloud, fibres, canvases) {
        this.sim = sim;
        this.cloud = cloud;
        this.fibres = fibres;
        this.glow = new Float32Array(cloud.count);
        this.nodeGroup = sim.nodes.map((n) => n.region.group);
        this.nodeColor = this.nodeGroup.map((g) => GROUP_COLOR[g]);
        for (const g of Object.keys(GROUP_COLOR))
            this.sprites.set(g, sprite(GROUP_COLOR[g]));
        const N = cloud.count, n = sim.nodes.length;
        this.mix = new Float32Array(n);
        this.rip = new Float32Array(N);
        this.fx2 = new Float32Array(fibres.count * 4);
        this.nodeRGB = new Float32Array(n * 3);
        this.groupRGB = new Float32Array(n * 3);
        sim.nodes.forEach((nd, k) => { const [r, g, b] = hexRgb(GROUP_COLOR[nd.region.group]); this.groupRGB.set([r / 255, g / 255, b / 255], k * 3); });
        this.nx = new Float32Array(N);
        this.ny = new Float32Array(N);
        this.nz = new Float32Array(N);
        this.blob = sim.nodes.map((nd) => nd.region.kind !== "shell");
        this.cx = new Float32Array(N);
        this.cy = new Float32Array(N);
        this.cz = new Float32Array(N);
        this.ncx = new Float32Array(n);
        this.ncy = new Float32Array(n);
        this.ncz = new Float32Array(n);
        const cnt = new Float32Array(n);
        for (let i = 0; i < N; i++) {
            this.cx[i] = cloud.x[i] - HULL.cx;
            this.cy[i] = cloud.y[i] - HULL.cy;
            this.cz[i] = cloud.z[i] - HULL.cz;
            const k = cloud.node[i];
            this.ncx[k] += this.cx[i];
            this.ncy[k] += this.cy[i];
            this.ncz[k] += this.cz[i];
            cnt[k]++;
        }
        for (let i = 0; i < N; i++) {
            const gx = this.cx[i] / (HULL.rx * HULL.rx), gy = this.cy[i] / (HULL.ry * HULL.ry), gz = this.cz[i] / (HULL.rz * HULL.rz);
            const m = Math.hypot(gx, gy, gz) || 1;
            this.nx[i] = gx / m;
            this.ny[i] = gy / m;
            this.nz[i] = gz / m;
        }
        const shellIdx = [];
        for (let i = 0; i < N; i++)
            if (!this.blob[cloud.node[i]])
                shellIdx.push(i);
        for (let h = 0; h < 480; h++)
            this.haze.push(shellIdx[Math.floor(Math.random() * shellIdx.length)]);
        for (let k = 0; k < n; k++) {
            const c = cnt[k] || 1;
            this.ncx[k] /= c;
            this.ncy[k] /= c;
            this.ncz[k] /= c;
        }
        // left and right turn in opposite directions from opposite sides; the third orbits from above and tilted
        const setup = {
            left: { yaw: Math.PI, pitch: 0.12, spin: 0.26, bob: 0.06 },
            right: { yaw: 0, pitch: 0.12, spin: -0.26, bob: 0.06 },
            top: { yaw: 0.6, pitch: 1.05, spin: 0.18, bob: 0.16 },
        };
        for (const id of ["left", "right", "top"]) {
            const canvas = canvases[id];
            if (!canvas)
                continue; // the sandbox shows just one view; the standalone brain shows three
            const s = setup[id];
            const view = {
                id, canvas, ctx: canvas.getContext("2d"), w: 0, h: 0, dpr: 1,
                yaw: s.yaw, pitch: s.pitch, basePitch: s.pitch, spin: s.spin, bob: s.bob, dragging: false, resumeAt: 0,
                sx: new Float32Array(N), sy: new Float32Array(N), near: new Float32Array(N), k: new Float32Array(N),
                nsx: new Float32Array(n), nsy: new Float32Array(n), nnear: new Float32Array(n),
                fx: new Float32Array(fibres.count), fy: new Float32Array(fibres.count),
                ca: 1, sa: 0, cp: 1, sp: 0, sc: 1, shade: new Float32Array(N), face: new Float32Array(N), spec: new Float32Array(N),
                bw: 0, bh: 0, acc: new Float32Array(0), img: null,
                off: document.createElement("canvas"), offCtx: null,
                bloom: document.createElement("canvas"), bloomCtx: null,
                mid: document.createElement("canvas"), midCtx: null,
            };
            view.midCtx = view.mid.getContext("2d");
            view.offCtx = view.off.getContext("2d");
            view.bloomCtx = view.bloom.getContext("2d");
            this.attachDrag(view);
            this.views.push(view);
        }
        for (const c of CHEMS) {
            this.srcNodes.push(c.source.flatMap((r) => sim.nodesOf(r)));
            this.tgtNodes.push(c.targets.filter((r) => r !== "*").flatMap((r) => sim.nodesOf(r)));
        }
        for (let i = 0; i < N; i++)
            if (sim.nodes[cloud.node[i]].region.kind === "shell")
                this.cortexNeurons.push(i);
        const ro = new ResizeObserver(() => this.resize());
        for (const vw of this.views)
            ro.observe(vw.canvas);
        this.resize();
    }
    /** drag a view to turn the brain by hand; it resumes spinning a moment after you let go */
    attachDrag(v) {
        const c = v.canvas;
        if (!c.addEventListener)
            return;
        let lx = 0, ly = 0;
        c.style.cursor = "grab";
        c.addEventListener("pointerdown", (e) => { v.dragging = true; lx = e.clientX; ly = e.clientY; c.setPointerCapture?.(e.pointerId); c.style.cursor = "grabbing"; });
        c.addEventListener("pointermove", (e) => {
            if (!v.dragging)
                return;
            v.yaw += (e.clientX - lx) * 0.012;
            v.basePitch = Math.max(-1.45, Math.min(1.45, v.basePitch + (e.clientY - ly) * 0.01));
            v.pitch = v.basePitch;
            lx = e.clientX;
            ly = e.clientY;
        });
        const end = () => { v.dragging = false; v.resumeAt = this.clock + 1.5; c.style.cursor = "grab"; };
        c.addEventListener("pointerup", end);
        c.addEventListener("pointercancel", end);
    }
    resize() {
        for (const vw of this.views) {
            const dpr = Math.min(window.devicePixelRatio || 1, 1.25); // the light buffer is rendered in software: 1.25x stays sharp and fast
            const w = Math.max(10, vw.canvas.clientWidth), h = Math.max(10, vw.canvas.clientHeight);
            vw.canvas.width = Math.round(w * dpr);
            vw.canvas.height = Math.round(h * dpr);
            vw.w = w;
            vw.h = h;
            vw.dpr = dpr;
            vw.bw = vw.canvas.width;
            vw.bh = vw.canvas.height;
            vw.acc = new Float32Array(vw.bw * vw.bh * 3);
            vw.off.width = vw.bw;
            vw.off.height = vw.bh;
            vw.img = vw.offCtx.createImageData(vw.bw, vw.bh);
            vw.mid.width = Math.max(8, Math.round(vw.bw / 2));
            vw.mid.height = Math.max(8, Math.round(vw.bh / 2));
            vw.bloom.width = Math.max(8, Math.round(vw.bw / 5));
            vw.bloom.height = Math.max(8, Math.round(vw.bh / 5));
            vw.ctx.fillStyle = "#050505";
            vw.ctx.fillRect(0, 0, vw.canvas.width, vw.canvas.height);
        }
    }
    /** advance spiking visuals + camera orbits, then draw all three views */
    draw(dt, time) {
        const { cloud, glow, sim } = this;
        this.clock += dt;
        const act = sim.activity;
        const decay = Math.exp(-dt / 0.13);
        const rhythm = (this.frameNo++ & 3) === 0; // the slow rhythm only needs updating every few frames
        for (let i = 0; i < cloud.count; i++) {
            const a = act[cloud.node[i]];
            // a region at 100 % fires its neurons at ~55 Hz, at rest roughly once a second
            this.seed ^= this.seed << 13;
            this.seed ^= this.seed >>> 17;
            this.seed ^= this.seed << 5; // xorshift: much cheaper than Math.random
            if (((this.seed >>> 0) / 4294967296) < (0.45 + a * a * 55) * dt)
                glow[i] = 1;
            else
                glow[i] *= decay;
            if (rhythm)
                this.rip[i] = 1 + 0.2 * Math.sin(this.clock * 1.3 - this.cy[i] * 0.07 - this.cz[i] * 0.04);
        }
        for (let k = 0; k < this.mix.length; k++) {
            const lift = act[k] - sim.rest[k];
            const target = Math.max(0, Math.min(1, (lift - 0.05) / 0.3));
            const m = this.mix[k];
            this.mix[k] = m + (target - m) * (1 - Math.exp(-dt / (target > m ? 0.1 : 1.6)));
        }
        for (let k = 0; k < this.mix.length; k++) {
            const m = this.mix[k], gr = 0.76;
            for (let c = 0; c < 3; c++)
                this.nodeRGB[k * 3 + c] = gr * (1 - m) + this.groupRGB[k * 3 + c] * m;
        }
        this.updateDrops(dt);
        const t0 = performance.now();
        for (const vw of this.views) {
            if (this.autoRotate && !vw.dragging && this.clock >= vw.resumeAt) {
                vw.yaw += vw.spin * dt;
                vw.pitch = vw.basePitch + vw.bob * Math.sin(this.clock * 0.35 + vw.spin * 9);
            }
            this.drawView(vw, time);
        }
        // adapt the number of cortex points to the machine
        const ms = performance.now() - t0;
        this.frameMs += (ms - this.frameMs) * 0.08;
        if (this.frameMs > 18)
            this.quality = Math.max(0.25, this.quality - 0.03);
        else if (this.frameMs < 11 && this.quality < 1)
            this.quality = Math.min(1, this.quality + 0.01);
    }
    project(vw, scale) {
        const W = vw.canvas.width, H = vw.canvas.height;
        const ca = Math.cos(vw.yaw), sa = Math.sin(vw.yaw), cp = Math.cos(vw.pitch), sp = Math.sin(vw.pitch);
        const mx = W / 2, my = H / 2;
        vw.ca = ca;
        vw.sa = sa;
        vw.cp = cp;
        vw.sp = sp;
        vw.sc = scale;
        const run = (x, y, z, i, sx, sy, near, k) => {
            const x1 = x * ca - y * sa, y1 = x * sa + y * ca; // turn about the vertical axis
            const depth = x1 * cp + z * sp; // toward the camera
            const zv = -x1 * sp + z * cp;
            const f = CAM / (CAM - depth); // perspective: near things are bigger
            sx[i] = mx + y1 * f * scale;
            sy[i] = my - zv * f * scale;
            near[i] = Math.max(0, Math.min(1, (depth + 85) / 170));
            if (k)
                k[i] = f;
        };
        const shellN = this.cloud.shellCount;
        for (let i = 0; i < this.cloud.count; i++) {
            // lighting: key light from the upper left and in front, plus a glowing rim where the surface turns away
            const nx = this.nx[i], ny = this.ny[i], nz = this.nz[i];
            const nx1 = nx * ca - ny * sa, ny1 = nx * sa + ny * ca;
            const nd = nx1 * cp + nz * sp;
            const face = Math.max(0, Math.min(1, (nd + 0.12) / 0.55));
            vw.face[i] = face;
            if (i < shellN && face < 0.04)
                continue; // far side of the cortex is never drawn: don't even project it
            run(this.cx[i], this.cy[i], this.cz[i], i, vw.sx, vw.sy, vw.near, vw.k);
            const nzv = -nx1 * sp + nz * cp;
            const lit = Math.max(0, nd * 0.55 - ny1 * 0.4 + nzv * 0.6);
            const rr = 1 - Math.max(0, nd);
            vw.shade[i] = 0.66 + 0.6 * lit + 0.12 * rr * rr * rr;
            // glossy highlight: half-vector between the light and the viewer
            const hd = nd * 0.82 + 0.55 * (-ny1 * 0.4) + 0.55 * nzv * 0.6;
            const h1 = Math.max(0, hd), h2 = h1 * h1, h4 = h2 * h2, h8 = h4 * h4;
            vw.spec[i] = h8 * h8 * h2 * 0.55; // ~ h^18
        }
        for (let n = 0; n < this.sim.nodes.length; n++)
            run(this.ncx[n], this.ncy[n], this.ncz[n], n, vw.nsx, vw.nsy, vw.nnear);
        // each fibre bows toward the centre of the brain: control point = midpoint pulled inward
        const tmpN = new Float32Array(1);
        for (let f = 0; f < this.fibres.count; f++) {
            const a = this.fibres.a[f], b = this.fibres.b[f];
            run((this.cx[a] + this.cx[b]) * 0.28, (this.cy[a] + this.cy[b]) * 0.28, (this.cz[a] + this.cz[b]) * 0.28, 0, tmp1, tmp2, tmpN);
            vw.fx[f] = tmp1[0];
            vw.fy[f] = tmp2[0];
        }
    }
    drawView(vw, time) {
        const { ctx, dpr } = vw;
        const W = vw.canvas.width, H = vw.canvas.height;
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#050505";
        ctx.fillRect(0, 0, W, H);
        const scale = (Math.min(vw.w, vw.h) / (2 * R)) * 0.98 * dpr;
        this.project(vw, scale);
        void scale;
        ctx.globalCompositeOperation = "lighter";
        this.drawWash(vw);
        this.drawFibres(vw, dpr);
        this.splat(vw);
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 1;
        ctx.drawImage(vw.off, 0, 0);
        // bloom: a blurred copy of the lit image added back on top gives the soft glow
        vw.bloomCtx.globalCompositeOperation = "source-over";
        vw.midCtx.drawImage(vw.off, 0, 0, vw.mid.width, vw.mid.height); // two-step downsample = a proper blur
        vw.bloomCtx.drawImage(vw.mid, 0, 0, vw.bloom.width, vw.bloom.height);
        ctx.globalAlpha = 0.5;
        ctx.drawImage(vw.bloom, 0, 0, W, H);
        ctx.globalAlpha = 1;
        this.drawChemistry(vw, dpr);
        // signal paths: a faint line and a travelling dot along the strongest active pathways
        if (this.showPaths) {
            ctx.globalAlpha = 1;
            let drawn = 0;
            for (const e of this.sim.strongestEdges) {
                if (drawn >= 14)
                    break;
                const near = Math.min(vw.nnear[e.from], vw.nnear[e.to]);
                const x1 = vw.nsx[e.from], y1 = vw.nsy[e.from], x2 = vw.nsx[e.to], y2 = vw.nsy[e.to];
                if (Math.hypot(x2 - x1, y2 - y1) < 8 * dpr)
                    continue;
                const fade = 0.35 + 0.65 * near;
                ctx.globalCompositeOperation = "lighter";
                ctx.strokeStyle = this.mix[e.from] > 0.25 ? this.nodeColor[e.from] : "#d0d0d0";
                ctx.globalAlpha = Math.min(0.35, 0.06 + e.strength * 0.5) * fade;
                ctx.lineWidth = dpr;
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
                const ph = (time * 0.8 + (e.from * 7 + e.to * 13) * 0.137) % 1;
                ctx.globalAlpha = 0.9 * fade;
                ctx.drawImage(this.white, x1 + (x2 - x1) * ph - 3 * dpr, y1 + (y2 - y1) * ph - 3 * dpr, 6 * dpr, 6 * dpr);
                drawn++;
            }
        }
        if (this.showLabels)
            this.drawLabels(vw);
        this.drawChemKey(vw);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        void W;
        void H;
    }
    level(i) {
        const c = CHEMS[i];
        return Math.max(0, Math.min(1, (this.sim.nm[c.id] - c.base) / 0.45));
    }
    /** project a point (centred mm) with this view's camera */
    pp(vw, x, y, z) {
        const x1 = x * vw.ca - y * vw.sa, y1 = x * vw.sa + y * vw.ca;
        const depth = x1 * vw.cp + z * vw.sp, zv = -x1 * vw.sp + z * vw.cp;
        const f = CAM / (CAM - depth);
        const o = this.o;
        o.x = vw.canvas.width / 2 + y1 * f * vw.sc;
        o.y = vw.canvas.height / 2 - zv * f * vw.sc;
        o.near = Math.max(0, Math.min(1, (depth + 85) / 170));
        o.f = f;
        return o;
    }
    /** release and move the chemical droplets */
    updateDrops(dt) {
        const live = CHEMS.map(() => 0);
        for (const d of this.drops) {
            d.t += dt;
            live[d.chem]++;
        }
        this.drops = this.drops.filter((d) => d.t < d.life);
        const j = (m) => (Math.random() - 0.5) * m;
        for (let ci = 0; ci < CHEMS.length; ci++) {
            const v = this.level(ci);
            if (v < 0.06) {
                this.spawnAcc[ci] = 0;
                continue;
            }
            this.spawnAcc[ci] += dt * (6 + 44 * v);
            while (this.spawnAcc[ci] >= 1 && live[ci] < 48) {
                this.spawnAcc[ci] -= 1;
                live[ci]++;
                const src = this.srcNodes[ci], tgt = this.tgtNodes[ci];
                const sn = src[Math.floor(Math.random() * src.length)];
                const a = [this.ncx[sn] + j(6), this.ncy[sn] + j(6), this.ncz[sn] + j(6)];
                let b;
                const toCortex = CHEMS[ci].targets.includes("*") && (tgt.length === 0 || Math.random() < 0.55);
                if (toCortex && this.cortexNeurons.length) {
                    const k = this.cortexNeurons[Math.floor(Math.random() * this.cortexNeurons.length)];
                    b = [this.cx[k] * 0.97, this.cy[k] * 0.97, this.cz[k] * 0.97];
                }
                else {
                    const tn = tgt[Math.floor(Math.random() * tgt.length)];
                    b = [this.ncx[tn] + j(8), this.ncy[tn] + j(8), this.ncz[tn] + j(8)];
                }
                const c = [(a[0] + b[0]) / 2 + j(34), (a[1] + b[1]) / 2 + j(34), (a[2] + b[2]) / 2 + j(34)];
                this.drops.push({ chem: ci, a, b, c, t: 0, life: 1.8 + Math.random() * 1.8 });
            }
        }
        for (const d of this.drops)
            void d;
    }
    /** a faint colour wash over the whole brain for the hormones that spread everywhere (cortisol, adrenaline, GABA, melatonin...) */
    drawWash(vw) {
        const { ctx } = vw;
        const cx = vw.canvas.width / 2, cy = vw.canvas.height / 2, r = R * vw.sc * 0.8;
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 1;
        for (let ci = 0; ci < CHEMS.length; ci++) {
            const c = CHEMS[ci];
            if (!c.wash)
                continue;
            const v = this.level(ci);
            if (v < 0.06)
                continue;
            const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
            g.addColorStop(0, rgba(c.color, c.wash * v * 0.85));
            g.addColorStop(0.6, rgba(c.color, c.wash * v * 0.4));
            g.addColorStop(1, rgba(c.color, 0));
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, vw.canvas.width, vw.canvas.height);
        }
    }
    /** halos where a chemical is released, droplets travelling to where it acts */
    drawChemistry(vw, dpr) {
        const { ctx } = vw;
        ctx.globalCompositeOperation = "lighter";
        for (let ci = 0; ci < CHEMS.length; ci++) {
            const v = this.level(ci);
            if (v < 0.06)
                continue;
            const pulse = 0.88 + 0.12 * Math.sin(this.clock * 4 + ci);
            for (const n of this.srcNodes[ci]) {
                const o = this.pp(vw, this.ncx[n], this.ncy[n], this.ncz[n]);
                const r = (4 + 10 * v) * vw.sc * o.f;
                ctx.globalAlpha = Math.min(0.7, (0.1 + 0.34 * v) * (0.45 + 0.55 * o.near) * pulse);
                ctx.drawImage(this.halos[ci], o.x - r, o.y - r, r * 2, r * 2);
            }
            for (const n of this.tgtNodes[ci]) {
                const o = this.pp(vw, this.ncx[n], this.ncy[n], this.ncz[n]);
                const r = (3 + 6 * v) * vw.sc * o.f;
                ctx.globalAlpha = Math.min(0.5, (0.04 + 0.17 * v) * (0.45 + 0.55 * o.near));
                ctx.drawImage(this.halos[ci], o.x - r, o.y - r, r * 2, r * 2);
            }
        }
        for (const d of this.drops) {
            const u = d.t / d.life, w = 1 - u;
            const x = w * w * d.a[0] + 2 * w * u * d.c[0] + u * u * d.b[0];
            const y = w * w * d.a[1] + 2 * w * u * d.c[1] + u * u * d.b[1];
            const z = w * w * d.a[2] + 2 * w * u * d.c[2] + u * u * d.b[2];
            const o = this.pp(vw, x, y, z);
            const v = this.level(d.chem);
            const s = Math.max(5 * dpr, vw.sc * 2.4) * o.f * (0.75 + 0.6 * v);
            ctx.globalAlpha = Math.sin(Math.PI * u) * (0.45 + 0.55 * o.near);
            ctx.drawImage(this.rings[d.chem], o.x - s, o.y - s, s * 2, s * 2);
        }
        ctx.globalAlpha = 1;
    }
    /** small key inside each view: which chemicals are flowing right now */
    drawChemKey(vw) {
        const { ctx, dpr } = vw;
        const active = CHEMS.map((c, i) => ({ c, i, v: this.level(i) })).filter((a) => a.v > 0.15).sort((p, q) => q.v - p.v).slice(0, 6);
        if (!active.length)
            return;
        ctx.globalCompositeOperation = "source-over";
        ctx.font = `${Math.round(10.5 * dpr)}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        active.forEach((a, k) => {
            const y = vw.canvas.height - (12 + (active.length - 1 - k) * 15) * dpr, x = 12 * dpr;
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = a.c.color;
            ctx.lineWidth = 1.6 * dpr;
            ctx.beginPath();
            ctx.arc(x + 4 * dpr, y, 4 * dpr, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = a.c.color;
            ctx.fillText(`${a.c.label}  ${Math.round(this.sim.nm[a.c.id] * 100)}`, x + 14 * dpr, y);
        });
        ctx.globalAlpha = 1;
    }
    /**
     * Software renderer for the neurons: every neuron adds light (colour x lighting) into a linear buffer,
     * then a soft tone-map turns it into pixels, so crowded regions glow instead of clipping to white.
     */
    splat(vw) {
        const { cloud, glow } = this;
        const acc = vw.acc, W = vw.bw, H = vw.bh, bs = vw.dpr;
        acc.fill(0);
        const act = this.sim.activity;
        const nodeRGB = this.nodeRGB;
        const qcomp = 1 / this.quality;
        const shellN = Math.floor(cloud.shellCount * this.quality);
        for (let pass = 0; pass < 2; pass++) {
            const from = pass === 0 ? 0 : cloud.shellCount, to = pass === 0 ? shellN : cloud.count;
            for (let i = from; i < to; i++) {
                const node = cloud.node[i];
                const deep = pass === 1;
                let vis;
                if (deep)
                    vis = 0.3 + 0.7 * vw.near[i]; // deep nuclei show through the glass
                else {
                    const f = vw.face[i];
                    if (f < 0.04)
                        continue;
                    vis = 0.08 + 0.92 * f;
                } // far-side cortex stays hidden
                const g = glow[i];
                const a = act[node];
                let I = ((deep ? 0.2 : 0.56 * qcomp) + 0.14 * a) * vw.shade[i] * cloud.crest[i] * this.rip[i] + (deep ? 0 : vw.spec[i] * qcomp * 0.18);
                I = (I + g * (deep ? 0.4 : 0.55)) * vis;
                const x = vw.sx[i], y = vw.sy[i];
                const w = g * g * 0.15; // a spiking neuron burns white at its core
                const r = nodeRGB[node * 3] + (1 - nodeRGB[node * 3]) * w;
                const gg = nodeRGB[node * 3 + 1] + (1 - nodeRGB[node * 3 + 1]) * w;
                const b = nodeRGB[node * 3 + 2] + (1 - nodeRGB[node * 3 + 2]) * w;
                const rad = (0.5 + 1.5 * g + (deep ? 0.45 : 0)) * bs;
                if (rad < 1.2) {
                    const ix = x | 0, iy = y | 0;
                    if (ix < 0 || iy < 0 || ix >= W - 1 || iy >= H - 1)
                        continue;
                    const fx = x - ix, fy = y - iy;
                    const w00 = (1 - fx) * (1 - fy) * I, w10 = fx * (1 - fy) * I, w01 = (1 - fx) * fy * I, w11 = fx * fy * I;
                    let j = (iy * W + ix) * 3;
                    acc[j] += w00 * r;
                    acc[j + 1] += w00 * gg;
                    acc[j + 2] += w00 * b;
                    acc[j + 3] += w10 * r;
                    acc[j + 4] += w10 * gg;
                    acc[j + 5] += w10 * b;
                    j += W * 3;
                    acc[j] += w01 * r;
                    acc[j + 1] += w01 * gg;
                    acc[j + 2] += w01 * b;
                    acc[j + 3] += w11 * r;
                    acc[j + 4] += w11 * gg;
                    acc[j + 5] += w11 * b;
                }
                else {
                    const x0 = Math.max(0, Math.floor(x - rad)), x1 = Math.min(W - 1, Math.ceil(x + rad));
                    const y0 = Math.max(0, Math.floor(y - rad)), y1 = Math.min(H - 1, Math.ceil(y + rad));
                    const inv = 1 / (rad * rad);
                    for (let yy = y0; yy <= y1; yy++)
                        for (let xx = x0; xx <= x1; xx++) {
                            const d2 = ((xx - x) * (xx - x) + (yy - y) * (yy - y)) * inv;
                            if (d2 >= 1)
                                continue;
                            const k = (1 - d2) * (1 - d2) * I * 1.15;
                            const j = (yy * W + xx) * 3;
                            acc[j] += k * r;
                            acc[j + 1] += k * gg;
                            acc[j + 2] += k * b;
                        }
                }
            }
        }
        // tone-map to pixels
        const data = vw.img.data, lut = this.lut, n = W * H;
        for (let p = 0, j = 0, q = 0; p < n; p++, j += 3, q += 4) {
            let v = (acc[j] * 256) | 0;
            data[q] = lut[v > 1023 ? 1023 : v];
            v = (acc[j + 1] * 256) | 0;
            data[q + 1] = lut[v > 1023 ? 1023 : v];
            v = (acc[j + 2] * 256) | 0;
            data[q + 2] = lut[v > 1023 ? 1023 : v];
            data[q + 3] = 255;
        }
        vw.offCtx.putImageData(vw.img, 0, 0);
    }
    /** white-matter tracts: a faint grey web; a tract takes colour only while BOTH of its ends are active */
    drawFibres(vw, dpr) {
        const { ctx } = vw;
        const { a, b, count } = this.fibres;
        ctx.lineWidth = 0.7 * dpr;
        ctx.strokeStyle = "#cfcfcf";
        ctx.globalAlpha = 0.05;
        ctx.beginPath();
        const lit = [];
        const ex = this.fx2; // endpoint cache: ax, ay, bx, by per fibre
        for (let f = 0; f < count; f++) {
            const A = this.pp(vw, this.cx[a[f]], this.cy[a[f]], this.cz[a[f]]);
            ex[f * 4] = A.x;
            ex[f * 4 + 1] = A.y;
            const B = this.pp(vw, this.cx[b[f]], this.cy[b[f]], this.cz[b[f]]);
            ex[f * 4 + 2] = B.x;
            ex[f * 4 + 3] = B.y;
            const m = Math.min(this.mix[this.cloud.node[a[f]]], this.mix[this.cloud.node[b[f]]]);
            if (m > 0.2) {
                lit.push(f);
                continue;
            }
            ctx.moveTo(ex[f * 4], ex[f * 4 + 1]);
            ctx.quadraticCurveTo(vw.fx[f], vw.fy[f], ex[f * 4 + 2], ex[f * 4 + 3]);
        }
        ctx.stroke();
        // corpus callosum
        ctx.strokeStyle = "#e8e8e8";
        ctx.globalAlpha = 0.06;
        ctx.lineWidth = 0.9 * dpr;
        ctx.beginPath();
        const cal = this.callosum;
        for (let i = 0; i < cal.length; i += 9) {
            const A = this.pp(vw, cal[i], cal[i + 1], cal[i + 2]);
            const ax = A.x, ay = A.y;
            const C = this.pp(vw, cal[i + 3], cal[i + 4], cal[i + 5]);
            const cx = C.x, cy = C.y;
            const B = this.pp(vw, cal[i + 6], cal[i + 7], cal[i + 8]);
            ctx.moveTo(ax, ay);
            ctx.quadraticCurveTo(cx, cy, B.x, B.y);
        }
        ctx.stroke();
        for (const f of lit) {
            const na = this.cloud.node[a[f]], nb = this.cloud.node[b[f]];
            const m = Math.min(this.mix[na], this.mix[nb]);
            ctx.strokeStyle = this.nodeColor[this.mix[na] >= this.mix[nb] ? na : nb];
            ctx.globalAlpha = Math.min(0.5, 0.12 + 0.4 * m);
            ctx.lineWidth = 1.1 * dpr;
            ctx.beginPath();
            ctx.moveTo(ex[f * 4], ex[f * 4 + 1]);
            ctx.quadraticCurveTo(vw.fx[f], vw.fy[f], ex[f * 4 + 2], ex[f * 4 + 3]);
            ctx.stroke();
        }
        ctx.lineWidth = dpr;
    }
    /** how coloured each system currently is (0..1), for the legend */
    groupColour() {
        const out = new Map();
        for (let k = 0; k < this.mix.length; k++)
            out.set(this.nodeGroup[k], Math.max(out.get(this.nodeGroup[k]) ?? 0, this.mix[k]));
        return out;
    }
    drawLabels(vw) {
        const { ctx, dpr } = vw;
        const act = this.sim.activity;
        const cand = [];
        for (const n of this.sim.nodes) {
            const k = n.index;
            const lift = act[k] - this.sim.rest[k];
            if (vw.nnear[k] > 0.38 && lift > 0.3)
                cand.push({ k, a: lift }); // only label what faces the camera
        }
        cand.sort((p, q) => q.a - p.a);
        ctx.globalCompositeOperation = "source-over";
        ctx.font = `${Math.round(10.5 * dpr)}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.textBaseline = "middle";
        const placed = [];
        let count = 0;
        for (const c of cand) {
            if (count >= 6)
                break;
            const x = vw.nsx[c.k], y = vw.nsy[c.k];
            const right = x < vw.canvas.width * 0.58;
            const lx = x + (right ? 22 : -22) * dpr;
            let ly = y - 14 * dpr;
            for (let tries = 0; tries < 6; tries++) {
                if (placed.every(([px, py]) => Math.abs(px - lx) > 70 * dpr || Math.abs(py - ly) > 13 * dpr))
                    break;
                ly += 13 * dpr;
            }
            placed.push([lx, ly]);
            const text = `${this.sim.nodes[c.k].node}  ${Math.round(act[c.k] * 100)}%`;
            ctx.globalAlpha = Math.min(1, 0.35 + c.a);
            ctx.strokeStyle = this.nodeColor[c.k];
            ctx.lineWidth = dpr * 0.8;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(lx - (right ? 3 : -3) * dpr, ly);
            ctx.stroke();
            ctx.textAlign = right ? "left" : "right";
            ctx.lineWidth = 3 * dpr;
            ctx.strokeStyle = "#050505";
            ctx.strokeText(text, lx, ly);
            ctx.fillStyle = this.nodeColor[c.k];
            ctx.fillText(text, lx, ly);
            count++;
        }
    }
}
