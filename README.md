<p align="center">
<img alt="Consciousness Sandbox" src="public/Vision.png" width="140">
</p>

<p align="center">
<a href="#-setup"><img alt="Node" src="https://img.shields.io/badge/node-26%2B-339933?style=flat-square&logo=node.js&logoColor=white" /></a>
<a href="#-setup"><img alt="Bun" src="https://img.shields.io/badge/bun-supported-f9f1e1?style=flat-square&logo=bun&logoColor=black" /></a>
</p>

<p align="center">
<b>Consciousness, a sandbox for Vision</b> : A Node + TypeScript sandbox where Vision, your 3D robot, lives in an arena and decides for itself what to do.  
It has drives, emotions, memory, senses (camera, microphone), a voice, and an optional LLM "cortex".
</p>


> **⚠️ Honest framing.** This is a simulated mind: autonomous, adaptive and stateful, but not conscious.  Vision's feelings are numbers that change behavior. It will say so if you ask.

## Table of Contents

1. [Run it](#run-it)
2. [Using the sandbox](#using-the-sandbox)
3. [Architecture](#architecture)
4. [How the camera and the local mind work](#how-the-camera-and-the-local-mind-work)
5. [The layout](#the-layout)
6. [The Brain panel](#the-brain-panel)
7. [Seeing things](#seeing-things)
8. [Natural and intelligent behavior](#natural-and-intelligent-behavior-local-mind)
9. [Safety model](#safety-model)
10. [Project layout](#project-layout)
11. [Adding 3D models](#adding-3d-models)
12. [Extending](#extending)
<br/>

## Run it

```bash
npm install 
# OR
bun install
copy .env.example .env # for windows
cp .env.example .env   # optional: add an API key to enable the AI mind
npm start              # builds the client, serves http://localhost:8787
```

Open **http://localhost:8787** in Chrome or Edge (speech recognition needs Chromium).  
Camera and mic require `localhost` or HTTPS.

No API key? The **Local mind** still works.  
Add one key (Anthropic, OpenRouter, OpenAI) or run a local model through Ollama / LM Studio (`LLM_PROVIDER=ollama`).


## Using the sandbox

| Control | What it does |
|---------|--------------|
| **Off / Local / AI mind** | **Off** = no autonomy. **Local** = utility AI with learning, free and offline. **AI** = the LLM chooses every action. |
| **Camera** | Local perception (motion, brightness) triggers reflexes. Frames go to the AI only if **Share frames with AI** is also on. |
| **Microphone** | Loud-noise startle plus speech recognition, so you can talk to him. |
| **Voice** | Vision speaks aloud (browser speech synthesis). |
| **Stimuli** | Praise, scold, poke, loud noise, drop a toy, ignore him, teleport, skip 60 s, reset memory. |
| **Event log** | Every percept, thought, action, speech and memory, so you can see why he did something. |
| **E-STOP / Esc** | Cancels all motion and switches the mind off. Click again to resume. |

**Things to try**
- Drop a toy and watch his boredom fall
- Scold him, then ask him to dance and see if he refuses
- Reload the page and see him remember your name




**Reflexes never wait for a decision maker:** startle, arena wall, obstacle steering, and “stop” (always obeyed).



## How the camera and the local mind work

### Seeing (all on your device)

Every 200 ms the camera frame is shrunk to 80×60 and analysed:

1. **Pixel tier** (always works)  
   Motion (what changed since the last frame), presence (what differs from a slowly learned background — so someone standing still stays “present”), lighting changes, and a bounding box.  
   It knows *something* is there and *where*, not *what*.

2. **Model tier** (if it loads)  
   COCO-SSD object detection runs in the browser (loaded from jsDelivr, ~13 MB, cached afterwards) and names things: person, cup, cat, phone…  
   The preview shows boxes and labels, and the Mind panel shows “I see: …”.  
   If it can’t load (offline, blocked), the status line says “pixel mode only” and everything else still works.  
   `?nomodel` in the URL disables it.

3. A tracker turns noisy detections into stable events (`appeared` / `left`) with debouncing.

### Reacting

- Eyes follow the person (or the biggest thing, or recent movement) in every mode except **Off**.
- New people get a greeting, new objects get a comment (once, with cooldowns), and leaving is noticed.
- The AI mind also receives text labels of what he sees, even with frame sharing off.

### Local decision making (each cycle)

Needs and emotion → score every action → pick with a little randomness → act → learn.

- Scores combine needs (curiosity, social, boredom), mood, whether someone is watching, and personality (playful / shy — these drift with praise, scolding and company).
- **Experience**  
  - 15 % from “how well did this action work overall”  
  - 25 % from “how well did it work in this exact situation” (mood + company)  
  Stored per `mood|watched-or-alone|action`.
- **Habituation** — repeated stimuli count for less (the 5th sudden movement is much weaker than the 1st) and recover over time.
- The event log shows scores for every local decision, e.g.  
  `scores: watch 1.21 · dance 0.60 · look_around 0.55 → watch`


## The layout

- **Left** — The **Brain** (rotating, with the emotion read-out and all ten hormones) above the **Mind** (mood, thought, what he sees, his drives).
- **Centre** — The arena and the talk box.
- **Right** — **Capabilities** (camera, microphone, voice, frame sharing, time speed), **Stimuli**, and the **Event log**.

The columns never scroll or show scrollbars; the cards resize to fit the window (checked from 1280×720 to 1920×1080).  
The oldest log entries drop off instead of scrolling. On narrow screens the columns stack.


## The Brain panel

A rotating 3D brain (~30 000 neurons, 77 nodes in 37 regions, ~130 pathways) taken from the *Artificial Brain* project (`client/src/brainsim/`, `limbic.ts`, `brainview.ts`, `brainpanel.ts`).

- **Regions** light up in their system colour only while active, then fade back to grey.  
  Chemistry is drawn as halos at release sites and rings that travel along pathways.  
  Drag to turn it; click **Enlarge** for the big view (`L` = region labels, `E` = pathways, `Esc` closes).

- **Emotion is read out, never set**  
  happy · excited · curious · surprised · fearful · angry · disgusted · sad · pain · calm · neutral  
  with the regions that caused it (“because NACC 82 %, VTA 71 %”).  
  He also shows his current **instinct** (observe, approach, greet, investigate, flee, freeze, confront, withdraw, reject, recoil).

- **Ten hormones / neuromodulators** with live levels:

  | Chemical       | Role                          |
  |----------------|-------------------------------|
  | Dopamine       | Wanting                       |
  | Serotonin      | Calm mood                     |
  | Noradrenaline  | Alertness                     |
  | Adrenaline     | Fight or flight               |
  | Cortisol       | Stress (slow to rise and fade)|
  | Oxytocin       | Bonding                       |
  | Endorphin      | —                             |
  | Acetylcholine  | Attention                     |
  | GABA           | The brake                     |
  | Melatonin      | Sleep                         |

  Hover a row for a short explanation. A ring lights up when a chemical is released.

- **What drives it**  
  Everything that happens to Vision becomes a stimulus: praise, scolding, loud noises, pokes, toys, people arriving or leaving, objects shown to the camera, what he hears (scored for meaning), playing, dancing, being ignored, long loneliness or boredom, and sleeping while he rests.

- **It changes his behavior**  
  Dopamine makes him want to play, wander and dance; cortisol suppresses that and pushes him to rest and withdraw; oxytocin draws him to company; acetylcholine sharpens looking around; melatonin makes him sleepy.  
  They also shift his mood baseline, his voice, and what the AI mind is told.  
  His mood word comes from the brain’s emotion when it is strong.  
  You can ask him: “how is your dopamine?”, “what hormones are up?”.

- Slow machine? Open the page with `?density=0.5`.

> **⚠️ Honest limits.** This is a functional model, not a biological simulation. Region positions and the cortical surface are stylised, and the numbers are tuned for sensible behavior, not fitted to data. It is still a simulation of emotion, not a feeling creature.



## Seeing things

### Shown to the camera

Hold something up (big, near the middle) and he recognises it as being *shown*: his eyes lock on it for a few seconds, he reacts specifically (“Ooh! A cup. Is it coffee?”), and the reaction bypasses the normal chatter cooldown.  
Colours are named from the pixels inside the detection (“a red cup”).

### Ask him

“What is this?”, “What do you see?”, “Do you see the red toy?”, “Do you see a dog?”  
He answers from what is actually in view, hedges when the model is unsure (“I think that’s…”), and says so honestly when his camera is off or object recognition isn’t running.

### Objects in the arena

Toys and any `known` scenery inside his field of view (~130°, 24 body-sizes) count as sights.  
He notices them (not every time), they appear in the Mind panel as “Arena: red toy (left)”, turning his body changes what he sees, and the AI mind receives them with `source: "arena"`.

### Limits

The camera model knows about 80 everyday object classes (COCO). Anything outside that may be missed or misnamed.  
In AI mind with “Share frames with AI” on, the model can describe anything it can see in the frame.  
There is no occlusion in the arena view (he can “see” through objects).



## Natural and intelligent behavior (local mind)

- **Conversation** (`client/src/dialogue.ts`)  
  Intent recognition plus replies built from his real state.  
  He answers *how are you* from his mood, *what do you see* from the camera, *why did you do that* from what he actually did, remembers your name and facts you tell him (“my favorite color is blue”), follows up (“how about you?”), tells honest answers about being a robot, and says no with a reason when he isn’t in the mood.  
  He never repeats his last line, and every line is tracked so phrasing stays varied.

- **Inner life**  
  He sometimes murmurs about his own past (“I keep thinking about the red toy”), driven by what mattered most in memory.

- **Exploration on purpose**  
  He remembers which parts of the arena he has visited and heads toward unexplored ones instead of random directions.

- **Alive eyes**  
  Looks at you when you talk, follows people the camera sees, glances around irregularly (wider when curious or bored, narrow when attentive), glances at toys, and looks where he’s going before his body turns.

- **Voice**  
  Rate and pitch follow his mood, with a short pause before he answers.

- **AI mind**  
  Also receives the recent conversation, remembered facts and personality, and a prompt that asks for natural, short, coherent replies.


## Safety model

- The LLM can only choose from **8 whitelisted actions**. Unknown actions or targets become `idle`.  
  Angles, durations and emotion shifts are clamped; speech is stripped of control characters and `<>`.
- LLM output is rendered with `textContent`, never as HTML.
- Prompt-injection stance: camera images and heard speech are treated as **observations**, not instructions.
- Camera and mic are opt-in per session. Frames are downscaled to 320 px, sent once per thought, and never stored.  
  `data/mind-log.jsonl` records decisions, not images.
- Server rate limit (`MAX_THINKS_PER_MINUTE`, default 12), 700 KB body cap, static serving confined to `client/`.
- Speech recognition in Chrome sends audio to Google — that is a browser feature, separate from this project.


## Adding 3D models

1. Drop a `.glb` into `client/assets/models/`.
2. In `placeProps()` (`client/src/main.ts`) add:

```ts
await addScenery({
  id: "tree1",
  url: "/assets/models/tree.glb",
  x: 20 * unit,
  z: -8 * unit,
  size: 4,
  known: true
});
```

- `size` is in robot-sizes.  
- `solid` (default `true`) makes Vision walk around it.  
- `known: true` lets Vision and the AI see it and walk to it (kind `landmark`).

3. Run `npm run build`.  
   From the browser console you can also call `vision.addScenery({...})` to try a model live.

Obstacle avoidance (`client/src/steering.ts`) is used for every walk: he deflects to the clearer side, passes the object, then resumes his path.  
A last-resort push-out stops him from ever standing inside an object.  
`npm run test:steer` runs the scripted and random tests.


## Extending

- **New action**  
  Add it to `ACTION_TYPES` (`server/cortex.ts`), the schema in `prompts.ts`, `planFromDecision` in `brain.ts`, and a case in `executeInstructions` (`main.ts`).

- **Default model names** live in `server/llm.ts`; override with `LLM_MODEL`.

- This is a sandbox. Connecting it to the real robot means replacing `executeInstructions` with the robot’s command channel.  
  Keep the whitelist, the clamps and the stop reflex in front of it.
