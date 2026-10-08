<p align="center">
  <img alt="Vision Logo" src="public/Vision.png" width="140">
</p>

<p align="center">
  <b>Consciousness</b>  a sandbox for <b>Vision</b>
</p>

<p align="center">
  <a href="#-setup"><img alt="Node" src="https://img.shields.io/badge/node-26%2B-339933?style=flat-square&logo=node.js&logoColor=white" /></a>
  <a href="#run-it"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square&logo=typescript&logoColor=white" /></a>
  <a href="#-setup"><img alt="Bun" src="https://img.shields.io/badge/bun-supported-f9f1e1?style=flat-square&logo=bun&logoColor=white" /></a>
</p>


> **⚠️ Honest framing.** This is a simulated mind: autonomous, adaptive and stateful, but **not conscious** and **not human-level AGI**. Vision's feelings are numbers that change behavior. It will say so if you ask.

## Versions


> v1.1 — Human-like brain upgrades

## Changed files
- `client/src/brainsim/emotion.ts` — mood / emotional inertia layer
- `client/src/brainsim/decision.ts` — conflict-dependent hesitation + calibrated noise
- `client/src/brainsim/regions.ts` — CNS major-division documentation + cerebellum weight
- `client/src/brain.ts` — stronger goals, goal shielding, fatigue, self-model, mood bias, hesitation tempo
- `README.md` — documents the upgrades

## How to run
```bash
cd consciousness
npm install
cp .env.example .env   # optional
npm start
```
Open http://localhost:8787 (Chrome/Edge recommended).

Local mind still decides all actions. LLM (if key present) only generates speech.

>  v1.2 — Neural core (CNS ratios)

### regions.ts
- Added `division: "cerebrum" | "cerebellum" | "brainstem"` on every region
- Assigned realistic relative neuron weights (cerebellum ≈ 2800, cortex shells 70–160, brainstem 12–45)
- Aggregate ratio targets ~19 % / 80 % / 1 %

### connectome.ts
- Strengthened cerebellar motor loops (M1↔CB, PMC↔CB, CB→THAL, etc.)

### simulation.ts
- Edge weights scaled by √(source neuron density) so denser regions have more influence

### decision.ts
- Cerebellum participates in APPROACH, INVESTIGATE, CONFRONT

### geometry.ts
- Visual point count uses √(neurons) so cerebellum stays dense but renderable

> v1.3 — Complete neural + UI wiring

- LimbicState exposes moodValence / moodArousal
- BrainSim reader feeds mood into emotion scoring
- Brain panel shows mood tag + CNS division neuron mass % (cerebrum / cerebellum / brainstem)
- Cerebellum has neuromod dynamics (ACh + dopamine) for motor timing
- index.html + CSS for division readout

> v1.4 — Smarter, nicer local mind

- **Intention stickiness**: commits to an action for 4–12s so behaviour is coherent, not twitchy
- **Smarter choose()**: temperature drops when there is a clear winner
- **Episodic memory bias**: recent good/bad episodes nudge future choices
- **Object preferences**: learns which toys he likes; prefers them when playing
- **Social presence**: less aimless wandering / calling out when someone is already there
- **Nicer speech** on play, dance, rest

> v1.5 — Final human-like polish

- Memory-aware greetings (name, time away, "I missed this")
- Richer goal formation (mood, fatigue, company, stress)
- softSay(): hesitation / hedging when conflict or low mood
- Scold → brief rest goal + drop intention (withdraw)
- Praise → brief social engagement goal
- Richer mood-colored murmurs
