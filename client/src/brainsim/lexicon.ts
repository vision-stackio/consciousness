import { Appraisal, ZERO_APPRAISAL, clamp } from "./types.js";

/**
 * Small hand-written affect lexicon (English). A trailing * marks a strong word.
 * This is the fallback "meaning" of text/captions when no language model is configured.
 */
const LEX: Record<string, string> = {
  reward: `love* loved loving happy joy* joyful wonderful amazing* awesome great good best win* won winner victory success
    congrats congratulations celebrate party gift present cake chocolate ice-cream icecream pizza biryani feast delicious tasty yummy sweet
    puppy* puppies kitten* kitty cute adorable* beautiful gorgeous pretty lovely sunset rainbow flower flowers sunshine beach holiday vacation
    smile smiling laugh laughing laughter hug* hugs cuddle kiss* cheer fun funny play playing treasure money rich gold praise proud pride
    thank thanks grateful promotion hired passed cured safe peaceful calm relax relaxing cozy warm cool nice kind kindness friendly
    surprise-party reward prize bonus applause cheering heaven paradise sparkle shiny fireworks diwali eid christmas music song dance dancing
    mom* mother* baby* babies cat dog bread coffee perfume jasmine fresh aroma fragrance incense roses mango curry soft* silky fur fluffy massage
    freshly-baked cookies honey mother's-cooking rain-smell petrichor`,
  threat: `danger* dangerous snake* snakes cobra python spider* scorpion shark crocodile lion tiger wolf bear gun* guns knife* blade sword bomb* explosion
    fire* burning flames attack* attacked attacker kill* killer murder* die death dead monster* ghost demon scary terrifying* terrified fear afraid scared
    scream* screaming run help! emergency accident crash collision fall falling cliff edge drown drowning flood earthquake storm tornado lightning
    thief robber robbery kidnap kidnapped hostage threat threaten threatening war soldier terrorist poison poisonous toxic virus infection
    blood* bleeding wound gunshot siren alarm intruder stalker chase chased chasing trap trapped dark-alley darkness stranger-danger
    fierce growl growling bite bitten snarl venom cancer gas-leak smoke*`,
  loss: `sad* sadness cry* crying cried tears weep grief* grieving funeral* died passed-away lost loss lonely* alone abandoned goodbye farewell miss missing
    missed breakup divorce failed failure rejected rejection fired unemployed broke bankrupt depressed depression hopeless empty hurt* heartbreak heartbroken
    sorry regret mourn mourning orphan homeless poor hungry starving miserable unhappy disappointed disappointing disappointment betrayed-sad
    tragedy tragic sorrow gloomy rainy-day nobody-cares worthless useless`,
  anger: `idiot* stupid* dumb moron loser shut-up hate* hated hatred liar* lied lying cheat* cheater betray* betrayed betrayal unfair injustice insult* insulted
    angry* furious* rage mad annoying annoyed irritating irritated disrespect disrespected rude jerk bastard bitch damn hell scum trash worthless-person
    garbage-person ugly-person fool fraud fake scam stole stolen blame blamed accuse accused humiliate humiliated mock mocked mocking bully bullied
    screw-you get-out useless-person pathetic disgusting-person`,
  disgust: `disgusting* gross* revolting nasty vomit* puke vomiting rotten* rot rotting moldy mould stink* stinks stinking smelly foul filthy dirty sewage
    garbage trash toilet poop poo feces shit pus slime slimy maggot maggots cockroach cockroaches rat rats worm worms leech bug-infested sticky greasy
    spoiled expired putrid mucus snot spit sweaty fungus lice rancid`,
  pain: `pain* painful ache aching hurt* hurts burn* burned burning sting stung cut* slash stab stabbed hit punch punched slap slapped kick kicked bruise
    fracture broken-bone injured injury sprain cramp migraine headache toothache sore agony* torture electric-shock shock scald scalded sharp needle injection
    thorn splinter pinch pinched twist twisted crushed squeezed rough scalding boiling-hot ice-cold freezing`,
  social: `friend* friends mom mother dad father brother sister family baby child kid kids girl boy man woman person people someone he she they you we
    teacher boss colleague neighbour neighbor stranger hello hi hey namaste goodbye bye talk talking say said ask asked tell told voice crowd group team
    wife husband girlfriend boyfriend partner crush grandma grandpa uncle aunt customer guest visitor human`,
  novelty: `new* strange* weird unknown mysterious mystery unexpected suddenly sudden unusual odd bizarre alien unfamiliar unseen first-time never-seen
    discover discovery surprise surprised shocking surprising what-is-that curious strange-noise glowing floating weird-sound unidentified`,
  face: `face* faces smile smiling eyes selfie portrait grin frown glare stare staring look-at-me`,
};

const PHRASES: Record<string, Partial<Record<keyof typeof LEX, number>>> = {
  "i love you": { reward: 1, social: 0.8 },
  "thank you": { reward: 0.6, social: 0.5 },
  "well done": { reward: 0.8, social: 0.4 },
  "good job": { reward: 0.8, social: 0.4 },
  "good morning": { reward: 0.4, social: 0.6 },
  "good night": { reward: 0.3, social: 0.5 },
  "shut up": { anger: 1, social: 0.6 },
  "go away": { anger: 0.7, loss: 0.4, social: 0.6 },
  "i hate you": { anger: 1, loss: 0.4, social: 0.8 },
  "i am sorry": { loss: 0.5, social: 0.6 },
  "passed away": { loss: 1 },
  "fell down": { pain: 0.7, threat: 0.4 },
  "watch out": { threat: 0.9, social: 0.4 },
  "look out": { threat: 0.9, social: 0.4 },
  "oh no": { threat: 0.4, loss: 0.3 },
  "no one": { loss: 0.4 },
  "all alone": { loss: 0.8 },
  "what is that": { novelty: 0.7 },
};

type Cat = keyof typeof LEX;
const WORDS = new Map<string, { cat: Cat; w: number }[]>();
for (const cat of Object.keys(LEX) as Cat[]) {
  for (const raw of LEX[cat].split(/\s+/).filter(Boolean)) {
    const strong = raw.endsWith("*");
    const word = raw.replace(/[*!]/g, "").toLowerCase();
    const list = WORDS.get(word) ?? [];
    list.push({ cat, w: strong ? 1 : 0.65 });
    WORDS.set(word, list);
  }
}

const NEGATORS = new Set(["not", "no", "never", "dont", "don't", "isnt", "isn't", "wasnt", "wasn't", "without", "hardly", "cant", "can't", "didnt", "didn't", "nobody"]);
const BOOST = new Set(["very", "so", "really", "extremely", "super", "totally", "absolutely", "incredibly", "terribly", "insanely", "completely"]);
const DAMP = new Set(["slightly", "little", "bit", "kinda", "somewhat", "barely", "mildly"]);

function lookup(word: string) {
  const tries = [word];
  if (word.endsWith("ing")) tries.push(word.slice(0, -3), word.slice(0, -3) + "e");
  if (word.endsWith("ed")) tries.push(word.slice(0, -2), word.slice(0, -1));
  if (word.endsWith("es")) tries.push(word.slice(0, -2));
  if (word.endsWith("s")) tries.push(word.slice(0, -1));
  if (word.endsWith("ly")) tries.push(word.slice(0, -2));
  for (const t of tries) { const hit = WORDS.get(t); if (hit) return hit; }
  return undefined;
}

export interface TextAppraisal { appraisal: Appraisal; matched: string[]; intensity: number }

/** Lexicon appraisal of any text. `matched` lists the words that carried meaning (for the terminal). */
export function appraiseText(text: string): TextAppraisal {
  const lower = text.toLowerCase();
  const sums: Record<Cat, number> = { reward: 0, threat: 0, loss: 0, anger: 0, disgust: 0, pain: 0, social: 0, novelty: 0, face: 0 };
  const matched: string[] = [];

  let rest = lower;
  for (const [phrase, eff] of Object.entries(PHRASES)) {
    if (rest.includes(phrase)) {
      rest = rest.split(phrase).join(" ");
      matched.push(`"${phrase}"`);
      for (const [c, v] of Object.entries(eff)) sums[c as Cat] += v as number;
    }
  }

  const tokens = rest.replace(/[^a-z0-9'\s-]/g, " ").split(/\s+/).filter(Boolean);
  const caps = new Set((text.match(/\b[A-Z]{3,}\b/g) ?? []).map((w) => w.toLowerCase()));
  for (let i = 0; i < tokens.length; i++) {
    const hit = lookup(tokens[i]);
    if (!hit) continue;
    let mult = 1;
    let negated = false;
    for (let k = Math.max(0, i - 3); k < i; k++) {
      if (NEGATORS.has(tokens[k])) negated = true;
      if (BOOST.has(tokens[k])) mult *= 1.4;
      if (DAMP.has(tokens[k])) mult *= 0.6;
    }
    if (caps.has(tokens[i])) mult *= 1.25;
    matched.push(negated ? `not ${tokens[i]}` : tokens[i]);
    for (const h of hit) {
      const v = h.w * mult;
      if (negated && h.cat === "reward") sums.loss += v * 0.5;
      else if (negated && (h.cat === "threat" || h.cat === "pain" || h.cat === "loss")) sums.reward += v * 0.35;
      else if (negated) sums[h.cat] += v * 0.15;
      else sums[h.cat] += v;
    }
  }

  const exclam = Math.min(3, (text.match(/!/g) ?? []).length);
  const emph = 1 + 0.1 * exclam;
  const sat = (x: number) => clamp((1 - Math.exp(-x * 1.5)) * emph);
  const a: Appraisal = { ...ZERO_APPRAISAL };
  a.reward = sat(sums.reward);
  a.threat = sat(sums.threat);
  a.loss = sat(sums.loss);
  a.anger = sat(sums.anger);
  a.disgust = sat(sums.disgust);
  a.pain = sat(sums.pain);
  a.social = clamp(sat(sums.social * 0.7) + 0.35 * clamp(Math.max(a.anger, a.reward) * (sums.social > 0 ? 1 : 0)));
  a.novelty = clamp(0.15 + sat(sums.novelty));
  a.face = sat(sums.face);
  finishAppraisal(a);
  const strength = clamp(Math.max(a.reward, a.threat, a.loss, a.anger, a.disgust, a.pain, a.novelty - 0.15, a.social * 0.6));
  return { appraisal: a, matched, intensity: clamp(0.35 + 0.65 * strength) };
}

/** Derive valence + arousal from the specific channels. */
export function finishAppraisal(a: Appraisal): Appraisal {
  const neg = Math.max(a.threat, a.disgust * 0.9, a.loss, a.anger * 0.9, a.pain * 0.9);
  a.valence = clamp(a.reward - neg + 0.1 * (a.reward > 0 ? a.social : 0), -1, 1);
  a.arousal = clamp(Math.max(a.threat, a.anger, a.reward * 0.8, a.novelty * 0.7, a.pain, a.disgust * 0.6, a.loss * 0.35));
  return a;
}
