import { respond, learnFrom, refusal } from "../client/js/dialogue.js";
let fails = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${n} ${x}`); if (!ok) fails++; };
const base = { mood: "content", valence: 0.2, arousal: 0.3, curiosity: 0.4, social: 0.3, boredom: 0.3, facts: {}, interactions: 3, thought: "Restless (curiosity 52%), so I'm going to explore.", lastAction: "wander",
  traits: { playful: 0.5, shy: 0.5 }, camera: true, seen: [], personPresent: false, lastSaid: [], date: new Date("2026-10-04T15:30:00") };
const ask = (t, over = {}) => respond(t, { ...base, ...over }, () => 0.1);

check("greets by name", ask("hello", { userName: "Ravi" }).reply.includes("Ravi"));
check("learns a name", learnFrom("my name is ravi").name === "Ravi");
check("learns a favorite", JSON.stringify(learnFrom("my favorite color is dark blue").facts) === '[["favorite color","dark blue"]]');
check("'I love you' is not a hobby", learnFrom("i love you").facts.length === 0);
check("recalls a fact", ask("what's my favorite color", { facts: { "favorite color": "blue" } }).reply.includes("blue"));
check("admits not knowing a fact", /haven't told me/.test(ask("what's my favorite food").reply));
check("describes what he sees", /you|person/.test(ask("what do you see", { seen: [{ label: "person", side: "center", near: true }, { label: "cup", side: "left", near: false }] }).reply));
check("says when camera is off", /camera's off/.test(ask("what do you see", { camera: false }).reply));
check("explains why (uses his real last action)", ask("why did you do that").reply.includes("somewhere new"));
check("answers how he is from his mood", /bored/i.test(ask("how are you", { mood: "bored" }).reply));
check("is honest about consciousness", /simulated/.test(ask("are you conscious?").reply));
check("understands a command politely phrased", ask("could you please dance?").command === "dance");
check("doesn't mistake 'I like to dance' for a command", ask("i like to dance").command === undefined);
check("turn left", ask("turn left").command === "turn_left");
check("follow-up to 'and you?' works", /Glad|Nice|Good/.test(ask("i'm good thanks", { lastTopic: "asked_how_user" }).reply));
check("empathy for a sad user", /sorry/i.test(ask("i feel sad").reply));
check("refusal gives a reason", refusal({ ...base, valence: -0.3 }, () => 0).includes("mood"));
check("tells the time", /3:30/.test(ask("what time is it").reply));
// variety: asking the same thing repeatedly never gives the same line back-to-back
let said = [], same = 0, prev = "";
for (let i = 0; i < 8; i++) { const r = respond("hello", { ...base, lastSaid: said }, Math.random).reply; if (r === prev) same++; prev = r; said = [...said, r].slice(-12); }
check("doesn't repeat himself back-to-back", same === 0, `(${same} repeats)`);

// ---- showing things to the camera / objects in the arena
const cup = { label: "cup", side: "center", near: true, color: "red", score: 0.9, source: "camera" };
check("'what is this' names the object with its colour", /red cup/.test(ask("what is this?", { seen: [cup] }).reply), `("${ask("what is this?", { seen: [cup] }).reply}")`);
check("unsure objects get a hedge", /I think/.test(ask("what's this", { seen: [{ ...cup, score: 0.55 }] }).reply));
check("'what is this' with camera off", /camera's off/.test(ask("what is this", { camera: false }).reply));
check("'what is this' in pixel mode is honest about its limits", /recognition isn't running/.test(ask("what is this", { visionMode: "pixels", seen: [{ label: "someone", side: "center", near: true, source: "camera" }], personPresent: true }).reply));
check("nothing shown yet", /anything to look at|closer/.test(ask("what is this", { seen: [] }).reply));
const toy = { label: "red toy", side: "left", near: false, source: "arena" };
const both = ask("what do you see", { seen: [cup, toy] }).reply;
check("describes camera and arena together", /red cup/.test(both) && /arena/.test(both) && /red toy/.test(both), `("${both}")`);
check("'do you see the red toy' finds it in the arena", /Yes, the red toy on my left/.test(ask("do you see the red toy?", { seen: [toy] }).reply), `("${ask("do you see the red toy?", { seen: [toy] }).reply}")`);
check("'do you see a dog' says no honestly", /don't see a dog/.test(ask("do you see a dog", { seen: [cup] }).reply));
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
