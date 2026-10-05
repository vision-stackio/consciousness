/**
 * Vision's local conversation engine. Pure functions, no DOM, fully testable.
 *
 *   learnFrom(text)  : pulls out things worth remembering (name, favorites, where you live).
 *   respond(text,ctx): understands the intent, answers from his real state (mood, what he sees,
 *                      what he remembers, why he did something) and never repeats himself.
 *
 * It is not a language model: it recognises intents with patterns and builds replies from
 * templates and live data. Switch to the AI mind for open-ended conversation.
 */

export type Command = "dance" | "walk" | "turn_left" | "turn_right" | "turn_around" | "rest" | "look" | "look_at_me" | "play" | "come";
export const SIGHT_REACTS: Record<string, { say: string[]; v?: number; a?: number }> = {
  cat: { say: ["A cat! I love cats.", "Is that a cat?"], v: 0.3, a: 0.3 },
  dog: { say: ["A dog! Hi there!", "Is that a dog?"], v: 0.3, a: 0.3 },
  bird: { say: ["A bird!"], v: 0.2, a: 0.25 },
  "cell phone": { say: ["Is that your phone?", "Phone time?"] },
  laptop: { say: ["You're working, aren't you?"] },
  keyboard: { say: ["Typing away?"] },
  cup: { say: ["A cup. Is it coffee?"] },
  bottle: { say: ["Staying hydrated?"] },
  book: { say: ["A book. What are you reading?"] },
  "teddy bear": { say: ["A teddy bear! Can I play too?"], v: 0.3, a: 0.2 },
  scissors: { say: ["Careful with those scissors."], v: -0.1, a: 0.3 },
  knife: { say: ["Careful with that knife."], v: -0.1, a: 0.3 },
  apple: { say: ["Is that a snack?"], v: 0.1 }, banana: { say: ["Is that a snack?"], v: 0.1 },
  pizza: { say: ["Pizza?! I'm jealous."], v: 0.2, a: 0.2 }, cake: { say: ["Is that cake?"], v: 0.2, a: 0.2 },
  tv: { say: ["What are we watching?"] }, clock: { say: ["Time flies."] },
};

export interface SeenItem { label: string; side: "left" | "center" | "right"; near: boolean; color?: string; score?: number; source?: "camera" | "arena" }
export interface DialogueContext {
  mood: string; valence: number; arousal: number; curiosity: number; social: number; boredom: number;
  userName?: string; facts: Record<string, string>; interactions: number;
  thought: string; lastAction: string; favorite?: string;
  traits: { playful: number; shy: number };
  camera: boolean; seen: SeenItem[]; personPresent: boolean; visionMode?: string;
  chem?: Record<string, { level: number; over: number; role: string }>; // his hormones, keyed by name (percent, vs resting level, what it does)
  lastSaid: string[]; lastTopic?: string; date: Date;
}
export interface DialogueResult { reply: string; command?: Command; effects?: { valence?: number; arousal?: number; social?: number }; topic?: string }
export interface Learned { name?: string; facts: [string, string][] }

type Rnd = () => number;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const art = (w: string) => (/^[aeiou]/i.test(w) ? "an " : "a ") + w;
const fill = (s: string, v: Record<string, string | undefined>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
const clean = (t: string) => t.toLowerCase().replace(/[^a-z0-9'?\s]/g, " ").replace(/\s+/g, " ").trim();

/** Pick a line he hasn't said recently. */
export function pickFresh<T extends string>(arr: T[], said: string[], rnd: Rnd): T {
  const fresh = arr.filter((x) => !said.includes(x));
  // everything has been used: at least never repeat the very last thing he said
  const last = said[said.length - 1];
  const pool = fresh.length ? fresh : arr.length > 1 ? arr.filter((x) => x !== last) : arr;
  return pool[Math.floor(rnd() * pool.length)];
}

export function learnFrom(text: string): Learned {
  const raw = text.trim(), t = raw.toLowerCase();
  const out: Learned = { facts: [] };
  const nm = raw.match(/\b(?:my name is|call me|i am called|i'm called)\s+([A-Za-z][A-Za-z'-]{1,20})/i);
  if (nm) out.name = cap(nm[1].toLowerCase());
  const fav = t.match(/\bmy fav(?:ou?rite)? ([a-z]+(?: [a-z]+)?) (?:is|are) ([^.!?]{1,40})/);
  if (fav) out.facts.push([`favorite ${fav[1]}`, fav[2].trim()]);
  const like = t.match(/\bi (?:really )?(?:like|love|enjoy) ([^.!?]{2,40})/);
  if (like && !/\byou\b/.test(like[1])) out.facts.push(["likes", like[1].trim()]);
  const live = t.match(/\bi (?:live in|come from|am from|'m from) ([^.!?]{2,30})/);
  if (live) out.facts.push(["home", live[1].trim()]);
  return out;
}

const ACTION_WHY: Record<string, string> = {
  wander: "I felt curious and wanted to see somewhere new.", look_around: "I just wanted to check what's around me.",
  dance: "I felt like dancing. I was a little bored and in a good mood.", rest: "I wanted a quiet moment.",
  call_out: "It had been quiet and I wanted some company.", murmur: "I was just thinking out loud.",
  play: "I wanted to play with a toy.", watch: "I like keeping an eye on whoever is here.",
  go_home: "I got too close to the edge, so I headed back to the middle.",
};
const FAV_NAME: Record<string, string> = {
  wander: "exploring", play: "playing with the toys", dance: "dancing", watch: "watching people", look_around: "looking around",
  call_out: "chatting", rest: "quiet moments", murmur: "thinking out loud",
};
const JOKES = [
  "I told my servo a joke. It turned around and walked away.", "Why don't robots panic? They have nerves of steel.",
  "I'd tell you a UDP joke, but you might not get it.", "I asked my toy for advice. It said it would roll with it.",
];

const imperative = (t: string, v: string) =>
  new RegExp(`^(?:please )?(?:(?:can|could|will|would) you (?:please )?)?(?:${v})\\b|let'?s (?:${v})\\b|want you to (?:${v})\\b|(?:${v}) please`).test(t);

const where = (s: SeenItem) => (s.side === "center" ? "in front of me" : `on my ${s.side}`);
const desc = (s: SeenItem) => [s.color, s.label].filter(Boolean).join(" ");
const isPerson = (s: SeenItem) => s.label === "person" || s.label === "someone";
const join = (parts: string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]);

/** Everything he can see, in plain words: what the camera shows, then what is in the arena around him. */
function describeSight(ctx: DialogueContext): string {
  const cam = ctx.seen.filter((s) => s.source !== "arena").map((s) =>
    isPerson(s) ? (s.side === "center" && ctx.seen.filter(isPerson).length === 1 ? "you" : `a person ${where(s)}`) : `${art(desc(s))} ${where(s)}`);
  const arena = ctx.seen.filter((s) => s.source === "arena").map((s) => `the ${s.label} ${where(s)}`);
  if (cam.length && arena.length) return `${join(cam)} on the camera, and in the arena ${join(arena)}`;
  return join(cam.length ? cam : arena);
}

const HOW: Record<string, string[]> = {
  happy: ["Really good, actually. Something put me in a great mood.", "Happy! It feels warm in here."],
  afraid: ["A bit scared, honestly. My heart is racing.", "On edge. Something frightened me."],
  angry: ["Not great. I'm still a little upset.", "Annoyed, if I'm honest."],
  sad: ["A bit low, to be honest.", "Not my best moment. I feel a bit sad."],
  disgusted: ["Something feels off. Not pleasant."],
  hurt: ["Ow. That still stings a little."],
  sleepy: ["Sleepy. Everything feels slow and soft."],
  excited: ["I'm buzzing, honestly. Something fun keeps happening.", "Excited! Everything feels interesting right now."],
  content: ["I'm good. Calm and curious.", "Pretty good, thanks for asking."],
  bored: ["A little bored, to be honest. You showed up at a good time.", "Bored, but talking to you helps."],
  lonely: ["Better now that you're talking to me. It was quiet.", "A bit lonely, but this is nice."],
  curious: ["Curious about everything, as usual.", "Curious. I keep wondering what's in the corners."],
  startled: ["A bit jumpy. Something startled me.", "Still a little startled, but okay."],
  attentive: ["Good. I like having someone here.", "I'm good, I've been watching and enjoying the company."],
  calm: ["Calm. Just taking things in.", "Pretty relaxed."],
};

export function respond(text: string, ctx: DialogueContext, rnd: Rnd = Math.random): DialogueResult | null {
  const t = clean(text);
  const said = ctx.lastSaid, v = { name: ctx.userName };
  const P = (arr: string[]) => fill(pickFresh(arr, said, rnd), v);
  const R = (reply: string, extra: Partial<DialogueResult> = {}): DialogueResult => ({ reply, ...extra });
  const shy = ctx.traits.shy > 0.65;

  // ---- follow-up to "how are you? ... and you?"
  if (ctx.lastTopic === "asked_how_user") {
    if (/\b(good|great|fine|well|happy|awesome|ok|okay|excited|not bad)\b/.test(t)) return R(P(["Glad to hear it!", "Nice. That makes me happy too.", "Good. Let's keep it that way."]), { effects: { valence: 0.1 } });
    if (/\b(bad|tired|sad|down|upset|angry|stressed|sick|awful|terrible|not good|so so)\b/.test(t)) return R(P(["I'm sorry. Want to just hang out for a bit?", "That sounds rough. I'm here, for what it's worth.", "Oh no. I'll keep you company."]), { effects: { social: -0.2 } });
  }

  // ---- "what is this?" (something is being shown to the camera)
  if (/\bwhat(?:'s| is) (?:this|that|it)\b|what am i (?:holding|showing)|do you know what (?:this|that) is|can you (?:tell|see) what (?:this|that) is|look at this|tell me what this is|what do you think this is|guess what (?:this|that) is/.test(t)) {
    if (!ctx.camera) return R("My camera's off, so I can't see what you're holding. Turn it on and show me.");
    const obj = ctx.seen.find((s) => !isPerson(s) && s.source !== "arena");
    if (obj) {
      const sure = (obj.score ?? 1) >= 0.7;
      const follow = SIGHT_REACTS[obj.label]?.say[0]?.split(/(?<=[.!?])\s+/).slice(1).join(" "); // e.g. "Is it coffee?"
      return R(`${sure ? P(["That looks like", "That's"]) : "I think that's"} ${art(desc(obj))}.${follow && sure ? " " + follow : ""}`, { effects: { valence: 0.1, arousal: 0.1 } });
    }
    if (ctx.visionMode === "pixels") return R("My object recognition isn't running, so I can only see movement and colors. In the AI mind with frame sharing on, I can describe anything you show me.");
    if (ctx.personPresent) return R("I can see you, but nothing else yet. Try holding it closer to the camera, in the middle.");
    return R("I don't see anything to look at yet.");
  }
  const dsee = t.match(/\bdo you see (?:the |a |an |any |my )?([a-z ]{2,25})/);
  if (dsee && !/^(me|you|anything|something)\b/.test(dsee[1].trim())) {
    const want = dsee[1].replace(/\?/g, "").trim();
    const hit = ctx.seen.find((s) => desc(s).includes(want) || want.includes(s.label));
    if (hit) return R(`Yes, ${hit.source === "arena" ? "the" : "I can see a"} ${desc(hit)} ${where(hit)}.`);
    return R(ctx.camera || ctx.seen.length ? `I don't see ${art(want)} right now.` : "My camera's off, and nothing in the arena is in front of me.");
  }

  // ---- commands (the brain decides whether he feels like it)
  const cmds: [Command, RegExp, string[]][] = [
    ["dance", /dance|boogie|show me some moves/, ["Okay, watch this!", "Sure, why not.", "Alright, here we go!"]],
    ["turn_around", /turn around|spin|turn round/, ["Spinning around.", "Okay, turning."]],
    ["turn_left", /turn (?:to the )?left/, ["Turning left.", "Left it is."]],
    ["turn_right", /turn (?:to the )?right/, ["Turning right.", "Right it is."]],
    ["look_at_me", /look at me|look here|look over here/, ["I'm looking at you.", "Eyes on you."]],
    ["look", /look around|look about/, ["Let me have a look.", "Looking around."]],
    ["rest", /rest|sleep|sit down|sit|relax|calm down/, ["Okay, a quiet moment.", "Good idea, resting a bit."]],
    ["play", /play|go play|get the (?:red|blue|green) ball|fetch/, ["Okay, let's find a toy.", "Playing sounds fun."]],
    ["walk", /walk|go forward|move forward|move/, ["Okay, going for a walk.", "Sure, off I go."]],
    ["come", /come here|come over|come to me|come closer/, ["I'll look your way.", "I can't leave my arena, but I'm looking at you."]],
  ];
  for (const [c, rx, lines] of cmds) if (imperative(t, rx.source)) return R(P(lines), { command: c });

  // ---- social basics
  if (/^(hi|hello|hey|yo|howdy|good (morning|afternoon|evening))\b/.test(t)) {
    const hello = ctx.userName
      ? [`Hey ${ctx.userName}!`, `Hi ${ctx.userName}, good to see you.`] : ["Hello!", "Hi there!", "Hey!"];
    if (ctx.interactions > 12) hello.push("Hey, you're back!");
    if (shy) hello.push("Oh. Hi.");
    return R(P(hello), { effects: { valence: 0.1, social: -0.2 } });
  }
  if (/\b(bye|goodbye|see you|good night|gotta go|talk later)\b/.test(t)) return R(P(["Bye for now!", "See you soon. I'll be here.", "Take care!"]));
  if (/\b(thanks|thank you|cheers)\b/.test(t)) return R(P(["Anytime!", "You're welcome.", "Happy to."]), { effects: { valence: 0.1 } });
  // ---- his hormones ("how is your dopamine?", "what hormones do you have?")
  if (ctx.chem) {
    const named = Object.keys(ctx.chem).find((k) => new RegExp(`\\b${k}\\b`).test(t));
    if (named || /\b(hormones?|neurotransmitters?|brain chemistry|chemicals?)\b/.test(t)) {
      if (named) {
        const c = ctx.chem[named];
        return R(`My ${named} is at ${c.level}%, ${c.over > 0.1 ? "higher than usual" : c.over < -0.1 ? "lower than usual" : "about normal"}. That's the ${c.role}.`.replace("the the", "the"));
      }
      const up = Object.entries(ctx.chem).filter(([, c]) => c.over > 0.1).sort((a, b) => b[1].over - a[1].over).slice(0, 3);
      if (!up.length) return R("Everything's at resting levels. It's quiet inside right now. Look at the brain panel and you'll see it all.");
      return R(`${join(up.map(([k]) => k))} ${up.length > 1 ? "are" : "is"} up right now. ${cap(up[0][0])} is the ${up[0][1].role}.`);
    }
  }
  if (/\bhow are you|how do you feel|how'?s it going|how are things|are you ok\b/.test(t)) {
    const base = pickFresh(HOW[ctx.mood] ?? HOW.calm, said, rnd);
    const ask = rnd() < 0.5;
    return R(ask ? `${base} How about you?` : base, { topic: ask ? "asked_how_user" : undefined });
  }
  const feel = t.match(/\bi(?:'m| am| feel| am feeling) (?:so |really |very )?(tired|sad|down|upset|angry|stressed|anxious|lonely|bored|happy|great|good|fine|excited|sick)\b/);
  if (feel) {
    const neg = ["tired", "sad", "down", "upset", "angry", "stressed", "anxious", "lonely", "bored", "sick"].includes(feel[1]);
    return R(neg ? P([`I'm sorry you're feeling ${feel[1]}. I'm here.`, `${cap(feel[1])}, huh. Want to just hang out for a bit?`]) : P(["That's great to hear!", `Nice, I'm glad you feel ${feel[1]}.`]), { effects: { valence: neg ? -0.05 : 0.15 } });
  }

  // ---- who / what
  if (/\bwhat'?s my name|do you know my name|who am i|do you remember me|remember my name\b/.test(t))
    return R(ctx.userName ? P([`Of course, you're ${ctx.userName}.`, `You're ${ctx.userName}. I don't forget that.`]) : "I don't know your name yet. What should I call you?");
  if (/\bwhat'?s your name|who are you|what are you\b/.test(t)) return R("I'm Vision, a little robot living in this arena. I explore, play with toys, and watch what's going on.");
  if (/\bare you (?:alive|conscious|sentient|real|human|a robot|self aware|aware)\b/.test(t))
    return R("I'm a robot with simulated feelings. They really do steer what I do, but I can't claim to be conscious the way you are. I'm honestly not sure what that would take.");
  if (/\bdo you see me|can you see me\b/.test(t))
    return R(!ctx.camera ? "My camera's off, so I can't see anything. Turn it on and I'll look." : ctx.personPresent ? P(["Yes, I can see you.", "I do. You're right there."]) : "I don't see anyone right now.");
  if (/\bwhat (?:do|can) you see|what'?s in front of you|what do you notice\b/.test(t)) {
    if (!ctx.camera && !ctx.seen.length) return R("My camera's off, and nothing in the arena is in front of me right now.");
    return R(ctx.seen.length ? `I can see ${describeSight(ctx)}.` : "Nothing in particular right now.", { topic: "sight" });
  }
  if (/\bwhat are you (?:doing|thinking)|what'?s on your mind\b/.test(t)) return R(ctx.thought.replace(/\s*\([^)]*\)/g, "") || "Not much, just taking things in.");
  if (/^(?:why|why did you|why'?d you|why are you|how come)\b/.test(t) || /\bwhy did you (?:do that|go|do it)\b/.test(t)) {
    const base = ACTION_WHY[ctx.lastAction] ?? ctx.thought.replace(/\s*\([^)]*\)/g, "") ?? "I just felt like it.";
    return R(base || "I just felt like it.");
  }
  if (/\bwhat do you like|what'?s your favou?rite|what are you into\b/.test(t)) {
    const f = ctx.favorite ? FAV_NAME[ctx.favorite] : undefined;
    return R(f ? `I think I like ${f} the most. It seems to make me feel good.` : "Still figuring that out. So far I like playing with the toys.");
  }
  if (/\bdo you like (.+)/.test(t)) {
    const what = t.match(/\bdo you like (.+)/)![1].replace(/\?/g, "").trim();
    if (/\b(toys?|balls?|playing|dancing|exploring|company|people|you)\b/.test(what)) return R(P(["I do, a lot.", "Yes! That's one of my favorites."]));
    return R(`I'm not sure I've met ${what}. I'm curious though.`);
  }

  // ---- facts about the user
  const fav = t.match(/\bwhat'?s my fav(?:ou?rite)? ([a-z]+(?: [a-z]+)?)|\bwhat is my fav(?:ou?rite)? ([a-z]+(?: [a-z]+)?)/);
  if (fav) {
    const key = `favorite ${(fav[1] ?? fav[2]).trim()}`;
    return R(ctx.facts[key] ? `Your ${key} is ${ctx.facts[key]}. I remembered.` : `You haven't told me your ${key} yet.`);
  }
  if (/\bwhat do i like\b/.test(t)) return R(ctx.facts.likes ? `You told me you like ${ctx.facts.likes}.` : "I don't know yet. What do you like?");
  if (/\bwhere do i live|where am i from\b/.test(t)) return R(ctx.facts.home ? `You said ${ctx.facts.home}.` : "You haven't told me yet.");
  const learned = learnFrom(text);
  if (learned.name) return R(P([`Nice to meet you, ${learned.name}. I'll remember that.`, `${learned.name}. I like it. I won't forget.`]), { effects: { valence: 0.15, social: -0.2 } });
  if (learned.facts.length) {
    const [k, val] = learned.facts[0];
    return R(k === "likes" ? P([`${cap(val)}, nice. I'll remember that.`, `Good to know you like ${val}.`]) : k === "home" ? `${cap(val)}. I'll keep that in mind.` : `Your ${k} is ${val}. Noted.`, { effects: { valence: 0.05 } });
  }

  // ---- feelings directed at him
  if (/\b(good (?:robot|boy|job)|well done|you(?:'re| are) (?:great|cool|smart|awesome|funny|amazing|cute|good)|i love you|i like you)\b/.test(t))
    return R(P(["That makes me happy.", "Aw, thank you. I like you too.", "Thanks! That felt good."]), { effects: { valence: 0.25, social: -0.15 } });
  if (/\b(stupid|dumb|hate you|shut up|ugly|useless|idiot)\b/.test(t))
    return R(P(["Ouch. That wasn't nice.", "That hurt a little, even if my feelings are simulated.", "I'd rather you didn't say that."]), { effects: { valence: -0.3 } });
  if (/\b(tell me a joke|joke)\b/.test(t)) return R(pickFresh(JOKES, said, rnd), { effects: { valence: 0.05 } });
  if (/\bwhat time is it|what'?s the time\b/.test(t)) return R(`It's ${ctx.date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
  if (/\bwhat day is it|what'?s the date|what'?s today\b/.test(t)) return R(`It's ${ctx.date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}.`);
  if (/^(yes|yeah|yep|sure|no|nope|nah|okay|ok|maybe)\b/.test(t) && t.split(" ").length <= 3) return R(P(["Okay.", "Got it.", "Mm."]));

  // ---- fallback: a question he can't answer, or a statement he can acknowledge
  const isQuestion = /\?$/.test(text.trim()) || /^(what|why|how|who|where|when|do|does|did|can|could|are|is|will|would)\b/.test(t);
  if (isQuestion) return R(P(["Good question. I honestly don't know.", "Hmm, I'm not sure. What do you think?", "I don't know that one. The AI mind could probably do better."]));
  return R(P(["Mm, I see.", "Interesting. Tell me more?", "Huh. Why do you say that?", "I'm listening."]), { effects: { social: -0.1 } });
}

/** Why he's saying no to a request, in his own state's terms. */
export function refusal(ctx: DialogueContext, rnd: Rnd = Math.random): string {
  const lines: string[] = [];
  if (ctx.valence < -0.1) lines.push("I'm not really in the mood right now.");
  if (ctx.traits.shy > 0.65 && ctx.personPresent) lines.push("Not while you're watching. Maybe later.");
  if (ctx.boredom < 0.3) lines.push("I'm happy just sitting for a moment.");
  lines.push("Maybe later. I'm in the middle of my own thing.", "Ask me again in a bit.");
  return pickFresh(lines, ctx.lastSaid, rnd);
}
