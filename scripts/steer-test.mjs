// Headless test of obstacle avoidance: scripted scenes plus 300 random ones.
import { Steering, resolveOverlap } from "../client/js/steering.js";
const angleDiff = (a, b) => (((a - b) % 360) + 540) % 360 - 180;
function run(name, goal, obstacles, { start = { x: 0, z: 0 }, stop = 2.2, body = 0.7 } = {}) {
  const st = new Steering(); let p = { ...start }, turn = 0, minClear = Infinity, t = 0, reached = false;
  const goalOb = obstacles.find((o) => Math.hypot(o.x - goal.x, o.z - goal.z) < 1)?.id;
  for (; t < 60 * 60; t += 1 / 60) {                    // 60 fps, up to 60 s
    const dx = goal.x - p.x, dz = goal.z - p.z;
    if (Math.hypot(dx, dz) <= stop) { reached = true; break; }
    const desired = (Math.atan2(dx, dz) * 180) / Math.PI;
    const heading = st.heading(p, desired, obstacles, { body, lookahead: 7, margin: 0.5, ignore: goalOb });
    turn += Math.max(-7, Math.min(7, angleDiff(heading, turn)));       // rig turn rate
    if (Math.abs(angleDiff(heading, turn)) < 28) {                       // walk when roughly aligned
      const y = (turn * Math.PI) / 180, v = 2.7 / 60;
      p.x += Math.sin(y) * v; p.z += Math.cos(y) * v;
    }
    const fix = resolveOverlap(p, obstacles, body, goalOb); if (fix) p = fix;
    for (const o of obstacles) if (o.id !== goalOb) minClear = Math.min(minClear, Math.hypot(o.x - p.x, o.z - p.z) - o.r - body);
  }
  console.log(`${reached ? "OK  " : "FAIL"} ${name.padEnd(34)} time ${t.toFixed(1)}s  min clearance ${minClear === Infinity ? "n/a" : minClear.toFixed(2)}`);
  return reached && minClear >= -0.01;
}
const res = [
  run("obstacle dead ahead (big model)", { x: 30, z: 0 }, [{ id: "a", x: 15, z: 0, r: 3 }]),
  run("obstacle slightly off-center", { x: 30, z: 0 }, [{ id: "a", x: 15, z: 1, r: 3 }]),
  run("toy ahead (small)", { x: 0, z: 30 }, [{ id: "t", x: 0, z: 14, r: 0.35 }]),
  run("two in a row", { x: 40, z: 0 }, [{ id: "a", x: 12, z: 0, r: 2 }, { id: "b", x: 24, z: 0.5, r: 2.5 }]),
  run("wall of three", { x: 30, z: 0 }, [{ id: "a", x: 15, z: -4, r: 3 }, { id: "b", x: 15, z: 0, r: 3 }, { id: "c", x: 15, z: 4, r: 3 }]),
  run("goal is the obstacle (toy target)", { x: 20, z: 0 }, [{ id: "g", x: 20, z: 0, r: 0.35 }]),
  run("start overlapping an obstacle", { x: 20, z: 0 }, [{ id: "a", x: 0.5, z: 0, r: 2 }]),
].every(Boolean);

// fuzz: random scenes; skip scenes where the goal or start sits inside an obstacle's keep-out zone
let rng = 12345; const rnd = () => ((rng = (rng * 1664525 + 1013904223) % 4294967296) / 4294967296);
let ran = 0, ok = 0; const bad = [];
const origLog = console.log; console.log = () => {};
for (let i = 0; i < 300; i++) {
  const n = 1 + Math.floor(rnd() * 6), obs = [];
  for (let k = 0; k < n; k++) obs.push({ id: "o" + k, x: (rnd() - 0.5) * 40, z: (rnd() - 0.5) * 40, r: 0.35 + rnd() * 3 });
  const goal = { x: (rnd() - 0.5) * 40, z: (rnd() - 0.5) * 40 };
  if (Math.hypot(goal.x, goal.z) < 8) continue;
  if (obs.some((o) => Math.hypot(o.x - goal.x, o.z - goal.z) < o.r + 3.5 || Math.hypot(o.x, o.z) < o.r + 2.5)) continue;
  ran++; if (run("fuzz", goal, obs)) ok++; else bad.push(i);
}
console.log = origLog;
console.log(`\nfuzz: ${ok}/${ran} random scenes reached the goal without touching anything` + (bad.length ? ` (failed scene ids: ${bad.slice(0, 10)})` : ""));
console.log(res && ok === ran ? "\nALL PASS" : "\nSOME FAILED");
process.exit(res && ok === ran ? 0 : 1);
