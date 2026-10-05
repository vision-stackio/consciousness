import { complete, type LLMConfig } from "./llm.js";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompts.js";

export interface Decision {
  thought: string;
  say: string | null;
  action: { type: string; target?: string; angle?: number; duration_ms?: number };
  emotion?: { valence: number; arousal: number };
  remember: string | null;
  next_think_in_s: number;
}

const ACTION_TYPES = new Set(["idle", "look", "turn", "wander", "go_to", "dance", "rest", "stop"]);
const clamp = (v: unknown, lo: number, hi: number, def: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, max) : "");

function extractJSON(raw: string): unknown {
  const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("model did not return JSON");
  return JSON.parse(raw.slice(a, b + 1));
}

/** The model proposes; this function decides what is allowed. Anything outside the whitelist becomes "idle". */
export function sanitize(raw: any, validTargets: Set<string>): Decision {
  const type = ACTION_TYPES.has(raw?.action?.type) ? raw.action.type : "idle";
  let target = text(raw?.action?.target, 40) || undefined;
  let finalType = type;
  if (type === "go_to" && (!target || !validTargets.has(target))) finalType = "idle";
  return {
    thought: text(raw?.thought, 240) || "…",
    say: text(raw?.say, 240) || null,
    action: {
      type: finalType, target: finalType === "go_to" ? target : undefined,
      angle: raw?.action?.angle === undefined ? undefined : clamp(raw.action.angle, -180, 180, 90),
      duration_ms: raw?.action?.duration_ms === undefined ? undefined : clamp(raw.action.duration_ms, 1500, 10000, 4000),
    },
    emotion: raw?.emotion ? { valence: clamp(raw.emotion.valence, -0.3, 0.3, 0), arousal: clamp(raw.emotion.arousal, -0.3, 0.3, 0) } : undefined,
    remember: text(raw?.remember, 120) || null,
    next_think_in_s: clamp(raw?.next_think_in_s, 3, 30, 8),
  };
}

export async function think(cfg: LLMConfig, request: any, frame: string | null): Promise<Decision> {
  const targets = new Set<string>(["home", ...(Array.isArray(request?.world) ? request.world.map((o: any) => String(o.id)) : [])]);
  const raw = await complete(cfg, { system: SYSTEM_PROMPT, user: buildUserMessage(request, !!frame && cfg.vision), image: frame });
  return sanitize(extractJSON(raw), targets);
}
