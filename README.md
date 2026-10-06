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


## Table of contents

1. [Run it](#run-it)
2. [Using the sandbox](#using-the-sandbox)
3. [Architecture](#architecture)
4. [How the camera and the local mind work](#how-the-camera-and-the-local-mind-work)
5. [The layout](#the-layout)
6. [The Brain panel](#the-brain-panel)
7. [Seeing things](#seeing-things)
8. [Face recognition](#face-recognition)
9. [Natural and intelligent behavior](#natural-and-intelligent-behavior-local-mind)
10. [Safety model](#safety-model)
11. [Adding 3D models](#adding-3d-models)
12. [Extending](#extending)
13. [Arena (open world)](#arena-open-world)



## Run it

```bash
npm install
cp .env.example .env     # optional: add an API key to enable the AI mind (speech)
npm start                # builds the client, serves http://localhost:8787
```

Open **http://localhost:8787** in Chrome or Edge (speech recognition needs Chromium).  
Camera and mic need `localhost` or HTTPS.

| Setup | Result |
| --- | --- |
| No API key | **Local mind** fully works offline (after models cache) |
| Anthropic / OpenRouter / OpenAI key | AI mind: LLM writes speech only |
| `LLM_PROVIDER=ollama` | Local model via Ollama / LM Studio |



## Using the sandbox

| Control | What it does |
| --- | --- |
| **Off / Local / AI mind** | **Off** = no autonomy. **Local** = local mind chooses every action (primary intelligence). **AI** = local mind still chooses actions; the LLM only generates natural speech. |
| **Camera** | Perception (pixels + COCO-SSD + face embeddings). Frames go to the LLM only if **Share frames with AI** is also on. |
| **Microphone** | Loud-noise startle + speech recognition so you can talk to him. |
| **Voice** | Browser speech synthesis (prosody follows mood). |
| **Stimuli** | Praise, scold, poke, ignore, loud noise, drop a toy, teleport, skip 60 s, teach face, reset memory. |
| **Event log** | Percepts, thoughts, actions, speech and memory — so you can see *why* he did something. |
| **E-STOP / Esc** | Cancels all motion and switches the mind off. Click again to resume. |

**Things to try**

- Turn the camera on — he faces the screen and tracks you
- Teach a name (`my name is Ada` or **Teach my face**)
- Drop a toy and watch boredom fall
- Scold him, then ask him to dance and see if he refuses
- Reload the page — learning and face embeddings persist

**Reflexes never wait for a decision maker:** startle, obstacle steering, and **stop** (always obeyed).  
(Arena wall is off when `ARENA_INFINITE` is true — see [Arena](#arena-open-world).)



## Architecture

```
 
```

The LLM never chooses actions. The simulated brain is the source of intelligence.

### Predictive-processing layer (`brainsim/predictive.ts`)

- Maintains a generative model (belief) over sensory features (valence, threat, reward, social, novelty…).
- On every stimulus: predicts → computes **prediction error (PE)** → updates beliefs (learning rate gated by acetylcholine).
- Uncertainty and PE supply **epistemic value** so INVESTIGATE / OBSERVE rise when the world is surprising.
- Live metrics appear in the Brain panel architecture strip.



## How the camera and the local mind work

### Seeing (all on your device)

Every ~200 ms the camera frame is analysed:

1. **Pixel tier** (always)  
   Motion, presence vs a slowly learned background, lighting, bounding box. Knows *something* is there and *where*, not *what*.

2. **Object tier** (COCO-SSD, if it loads)  
   Names everyday objects (person, cup, cat, phone…). ~13 MB from jsDelivr, **cached** for later offline reuse. Retries on failure. `?nomodel` disables it.

3. **Face tier** (face-api.js embeddings)  
   Tiny face detector + 128-d recognition net. Multi-person match by cosine distance. See [Face recognition](#face-recognition).

4. **Tracker**  
   Turns noisy detections into stable `appeared` / `left` events.

### Reacting

- Camera on → body faces the **screen / viewer**; eyes track the person (or object / motion).
- Someone on camera stops free wandering so he can look at you.
- New people / objects get comments (with cooldowns); leaving is noticed.
- AI mind receives **text labels** of what he sees even when frame sharing is off.

### Local decision making (each cycle)

Needs and emotion → score every action → soft-max pick → act → learn.

- Scores use needs, mood, company, personality, hormones, goals, and theory-of-mind.
- Experience and habituation shape future choices.
- The event log shows scores for each local decision.



## The layout

| Column | Content |
| --- | --- |
| **Left** | **Brain** (3D brain, emotion, hormones, architecture strip) above **Mind** (mood, thought, sights, drives) |
| **Centre** | 3D stage + talk box |
| **Right** | Capabilities, Stimuli, Event log |

Cards resize to the window; oldest log lines drop instead of scrolling. Narrow screens stack the columns.

---

## The Brain panel

A rotating 3D brain (~30 000 neurons, 77 nodes in 37 regions, ~130 pathways) from the *Artificial Brain* project (`client/src/brainsim/`, `limbic.ts`, `brainview.ts`, `brainpanel.ts`), plus a live **architecture strip** (Percept → Model → Predict → PE → Need → Act → Decide) with uncertainty, prediction error and epistemic value.

- **Regions** light up while active, then fade. Chemistry: halos and rings along pathways. Drag to turn; **Enlarge** for the big view (`L` labels, `E` pathways, `Esc` closes).
- **Emotion is read out, never set** — happy, excited, curious, surprised, fearful, angry, disgusted, sad, pain, calm, neutral — with contributing regions and current **instinct**.
- **Ten neuromodulators:** dopamine, serotonin, noradrenaline, adrenaline, cortisol, oxytocin, endorphin, acetylcholine, GABA, melatonin. Hover for roles; a ring lights on release.
- Hormones feed back into drives, voice and (when AI mind is on) the speech prompt.
- Slow machine? Open with `?density=0.5`.

> **⚠️ Honest limits.** Functional model, not a biological simulation. Stylised geometry; numbers tuned for behavior, not fitted to data. Simulation of emotion, not a feeling creature.


## Seeing things

### Shown to the camera

Hold something large near the centre — eyes lock briefly, he may comment specifically, colours come from pixels inside the box ("a red cup").

### Ask him

"What is this?", "What do you see?", "Do you see a dog?" — answers from current sights; hedges when unsure; admits when the camera or model is off.

### Objects in the arena

Toys and `known` scenery in ~130° FOV count as sights (`source: "arena"`), with distance-based confidence and simple occlusion ordering.

### Limits

COCO covers ~80 everyday classes. Outside that, things may be missed or misnamed. With **Share frames with AI**, the LLM can describe the raw frame more freely.


## Face recognition

Uses **face-api.js** (same family as the real Vision robot stack):

1. Turn **Camera** on (first visit downloads models; browser caches them).
2. Face the camera with decent light.
3. Teach: button **Teach my face**, or say  
   `my name is Ada` · `I am Bob` · `call me Maya`
4. Teach **2–3 times** from different angles.
5. Later faces match by embedding distance (multi-person).
6. `forget everyone` or **Reset memory** clears embeddings and signatures.

Stored in `localStorage` (`vision.faceEmbeddings.v1`, plus a coarse fallback signature).


## Natural and intelligent behavior (local mind)

- **Conversation** (`dialogue.ts`) — intents from real state: mood, sights, last action, remembered facts, name. Honest about being a robot; refuses with reasons when not in the mood.
- **Theory of mind** — friendliness, attention, trust, inferred mood/goal, patience, shared knowledge bias social actions.
- **Inner life** — occasional murmurs from memory.
- **Exploration** — prefers less-visited directions (no artificial edge when the arena is infinite).
- **Alive eyes / body** — face the screen when the camera is on; track people; glance when idle; look where he is going before turning.
- **Voice** — rate and pitch follow mood; short pause before answering.
- **AI mind** — same local action choice; LLM only phrases the reply, with conversation and personality context.


## Safety model

- LLM actions are constrained by a whitelist; unknown ops become idle. Angles, durations and emotion shifts are clamped; speech is stripped of control characters and `<>`.
- LLM output is rendered with `textContent`, never as HTML.
- Camera images and heard speech are **observations**, not instructions.
- Camera and mic are opt-in. Frames are downscaled (320 px), sent once per thought if shared, and not stored by the app. Logs record decisions, not images.
- Server rate limit (`MAX_THINKS_PER_MINUTE`, default 12), body size cap, static files confined to `client/`.
- Browser speech recognition may send audio to Google — that is a browser feature, not this server.


## Adding 3D models

1. Drop a `.glb` into `client/assets/models/`.
2. In `placeProps()` (`client/src/main.ts`):

```ts
await addScenery({
  id: "tree1",
  url: "/assets/models/tree.glb",
  x: 20 * unit,
  z: -8 * unit,
  size: 4,
  known: true,   // visible to Vision / AI as a landmark
});
```

- `size` — in robot-sizes  
- `solid` (default `true`) — he walks around it  
- `known: true` — appears in sights (`kind: landmark`)

3. `npm run build`. Live try from the console: `vision.addScenery({...})`.

Steering (`steering.ts`) deflects around obstacles; a last-resort push-out prevents standing inside geometry. `npm run test:steer` runs scripted and random tests.


## Extending

- **New action** — `ACTION_TYPES` (`server/cortex.ts`), schema in `prompts.ts`, `planFromDecision` in `brain.ts`, case in `executeInstructions` (`main.ts`).
- **Default models** — `server/llm.ts`; override with `LLM_MODEL`.
- **Real robot** — replace `executeInstructions` with the robot command channel. Keep the whitelist, clamps and stop reflex in front of it.


## Arena (open world)

By default the sandbox runs with an **open world**:

```ts
// client/src/brain.ts
export const ARENA_INFINITE = true;
```

| `ARENA_INFINITE` | Behavior |
| --- | --- |
| `true` | No purple ring, no wall stop, no forced go-home at the edge |
| `false` | Finite arena radius `ARENA` (40 body-sizes), purple ring, wall reflex |

The ground grid still tiles under him as he walks.
