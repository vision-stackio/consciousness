// Headless tests for the visual pipeline (PixelAnalyzer + SightTracker) with synthetic frames.
import { PixelAnalyzer, SightTracker, colorName, dominantColor, worldDetections, arenaLabel } from "../client/js/vision.js";
const W = 80, H = 60;
let rng = 7; const noise = () => ((rng = (rng * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * 10;
const frame = (rect, base = 90) => {
  const g = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inside = rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
    g[y * W + x] = Math.max(0, Math.min(255, (inside ? 200 : base) + noise()));
  }
  return g;
};
let fails = 0; const check = (name, ok, extra = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${name} ${extra}`); if (!ok) fails++; };

// 1. empty room produces no false detections
let pa = new PixelAnalyzer(W, H), s;
for (let i = 0; i < 30; i++) s = pa.analyze(frame(null));
check("empty room: no presence, no motion", s.presence < 0.01 && s.motion < 0.02 && s.box === null, `(presence ${s.presence.toFixed(3)}, motion ${s.motion.toFixed(3)})`);

// 2. a person (rect) walks in on the right, then stands still
const tr = new SightTracker(); let events = [], t = 0;
for (let i = 0; i < 5; i++) { s = pa.analyze(frame({ x: 50 + i * 2, y: 10, w: 20, h: 40 })); t += 200;
  const dets = s.box ? [{ label: "someone", score: 0.5, ...s.box }] : []; events.push(...tr.update(dets, t)); }
const appeared = events.find((e) => e.type === "appeared");
check("person walking in is detected", !!appeared && appeared.label === "someone");
check("on the right side of the view", appeared?.side === "right", `(side ${appeared?.side})`);
let still = 0;
for (let i = 0; i < 150; i++) { s = pa.analyze(frame({ x: 58, y: 10, w: 20, h: 40 })); t += 200;       // 30 s standing still
  const ev = tr.update(s.box ? [{ label: "someone", score: 0.5, ...s.box }] : [], t); still += ev.filter((e) => e.type === "left").length; }
check("standing still for 30 s is NOT mistaken for leaving", still === 0 && tr.current().length === 1);

// 3. leaves
events = [];
for (let i = 0; i < 40; i++) { s = pa.analyze(frame(null)); t += 200; events.push(...tr.update(s.box ? [{ label: "someone", score: 0.5, ...s.box }] : [], t)); }
const left = events.find((e) => e.type === "left");
check("leaving is detected", !!left, `(after ${left ? (left.durationMs / 1000).toFixed(0) : "?"}s present)`);

// 4. lights switch off: should be a lighting change, not a person
pa = new PixelAnalyzer(W, H); for (let i = 0; i < 10; i++) pa.analyze(frame(null, 120));
s = pa.analyze(frame(null, 30));
check("lights off = lighting change, no phantom person", s.lightingChange && s.box === null);

// 5. sudden big movement shows up as motion
pa = new PixelAnalyzer(W, H); for (let i = 0; i < 10; i++) pa.analyze(frame(null));
pa.analyze(frame({ x: 10, y: 5, w: 30, h: 50 })); s = pa.analyze(frame({ x: 40, y: 5, w: 30, h: 50 }));
check("sudden movement registers", s.motion > 0.12, `(motion ${s.motion.toFixed(2)})`);

// 6. tracker debounce: a one-frame flicker is ignored
const tr2 = new SightTracker(); const ev2 = [];
ev2.push(...tr2.update([{ label: "cup", score: 0.9, cx: 0.5, cy: 0.5, w: 0.1, h: 0.1 }], 0)); ev2.push(...tr2.update([], 200));
check("single-frame flicker ignored", ev2.length === 0);
// 7. model-style labels: appears, persists, leaves
const ev3 = []; let tt = 0;
for (let i = 0; i < 4; i++) { tt += 450; ev3.push(...tr2.update([{ label: "person", score: 0.9, cx: 0.2, cy: 0.5, w: 0.4, h: 0.8 }], tt)); }
check("labelled object appears once", ev3.filter((e) => e.type === "appeared").length === 1 && ev3[0].side === "left" && ev3[0].near);

// 8. colour naming
const cn = [[220, 30, 30, "red"], [30, 90, 220, "blue"], [40, 180, 70, "green"], [240, 220, 40, "yellow"], [245, 245, 245, "white"], [20, 20, 20, "black"], [130, 130, 130, "gray"], [150, 80, 30, "brown"], [255, 150, 30, "orange"], [140, 60, 200, "purple"], [250, 170, 190, "pink"]];
check("colour names", cn.every(([r, g, b, n]) => colorName(r, g, b) === n), cn.filter(([r, g, b, n]) => colorName(r, g, b) !== n).map(([r, g, b, n]) => `${n}->${colorName(r, g, b)}`).join(" "));
// a red object on a gray background, found in a box given in mirrored coordinates
const W2 = 80, H2 = 60, rgba = new Uint8ClampedArray(W2 * H2 * 4);
for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) { const i = (y * W2 + x) * 4, red = x >= 50 && x < 70 && y >= 20 && y < 45; rgba.set(red ? [210, 25, 30, 255] : [120, 120, 120, 255], i); }
check("dominant colour of a detection box (mirrored)", dominantColor(rgba, W2, H2, { cx: 1 - 60 / 80, cy: 32 / 60, w: 0.25, h: 0.4 }, true) === "red");
// 9. arena field of view
const pose = { x: 0, z: 0, headingDeg: 0, unit: 1 };
const objs = [{ id: "a", label: "ahead", x: 0, z: 10, r: 0.35 }, { id: "b", label: "behind", x: 0, z: -10, r: 0.35 }, { id: "c", label: "right", x: 8, z: 8, r: 0.35 }, { id: "d", label: "far", x: 0, z: 60, r: 0.35 }];
const wd = worldDetections(pose, objs);
check("arena: sees what is ahead and to the side, not behind or far away", wd.map((d) => d.label).sort().join() === "ahead,right");
check("arena: object on the right appears on the right of the view", wd.find((d) => d.label === "right").cx > 0.6 && Math.abs(wd.find((d) => d.label === "ahead").cx - 0.5) < 0.01);
check("arena: turning changes what he sees", worldDetections({ ...pose, headingDeg: 180 }, objs).map((d) => d.label).join() === "behind");
check("arena: nearer objects look bigger", worldDetections(pose, [{ id: "n", label: "n", x: 0, z: 3, r: 0.35 }])[0].w > wd.find((d) => d.label === "ahead").w);
check("arena labels read naturally", arenaLabel("toy_red") === "red toy" && arenaLabel("toy_k3f") === "new toy" && arenaLabel("big_tree") === "big tree");
// 10. appeared events carry size, position and colour (so "shown to the camera" can be detected)
const trc = new SightTracker(); trc.update([{ label: "cup", score: 0.9, cx: 0.5, cy: 0.5, w: 0.3, h: 0.3, color: "red" }], 0);
const evc = trc.update([{ label: "cup", score: 0.9, cx: 0.5, cy: 0.5, w: 0.3, h: 0.3, color: "red" }], 200)[0];
check("appeared event carries size, colour and position", evc.size > 0.07 && evc.color === "red" && evc.cx === 0.5);
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
