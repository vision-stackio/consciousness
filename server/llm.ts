/** Provider-agnostic LLM call with optional image input. Plain fetch, no SDKs. */

export type Provider = "anthropic" | "openai" | "openrouter" | "ollama" | "none";
export interface LLMConfig { provider: Provider; model: string; apiKey?: string; baseUrl: string; vision: boolean }

export function loadLLMConfig(env: NodeJS.ProcessEnv): LLMConfig {
  const forced = (env.LLM_PROVIDER ?? "").toLowerCase();
  const provider = (["anthropic", "openai", "openrouter", "ollama", "none"].includes(forced) ? forced
    : env.ANTHROPIC_API_KEY ? "anthropic" : env.OPENROUTER_API_KEY ? "openrouter" : env.OPENAI_API_KEY ? "openai" : "none") as Provider;
  const defaults: Record<Provider, { model: string; baseUrl: string; key?: string }> = {
    anthropic: { model: "claude-sonnet-5-5", baseUrl: "https://api.anthropic.com", key: env.ANTHROPIC_API_KEY },
    openai: { model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1", key: env.OPENAI_API_KEY },
    openrouter: { model: "anthropic/claude-sonnet-4.5", baseUrl: "https://openrouter.ai/api/v1", key: env.OPENROUTER_API_KEY },
    ollama: { model: "llava", baseUrl: "http://localhost:11434/v1" },
    none: { model: "", baseUrl: "" },
  };
  const d = defaults[provider];
  return {
    provider, model: env.LLM_MODEL || d.model, apiKey: d.key, baseUrl: env.LLM_BASE_URL || d.baseUrl,
    vision: (env.LLM_VISION ?? "true") !== "false",
  };
}

export const isConfigured = (c: LLMConfig) => c.provider !== "none" && (c.provider === "ollama" || !!c.apiKey);

export interface CompleteInput { system: string; user: string; image?: string | null; maxTokens?: number }

function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const m = url.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  return m ? { mediaType: m[1], data: m[2] } : null;
}

export async function complete(cfg: LLMConfig, input: CompleteInput): Promise<string> {
  const img = cfg.vision && input.image ? parseDataUrl(input.image) : null;
  const signal = AbortSignal.timeout(25000);
  const maxTokens = input.maxTokens ?? 500;

  if (cfg.provider === "anthropic") {
    const content: unknown[] = [];
    if (img) content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
    content.push({ type: "text", text: input.user });
    const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
      method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": cfg.apiKey ?? "", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system: input.system, messages: [{ role: "user", content }] }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (j.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  }

  // OpenAI-compatible (OpenAI, OpenRouter, Ollama, LM Studio, vLLM...)
  const userContent: unknown[] = [{ type: "text", text: input.user }];
  if (img) userContent.push({ type: "image_url", image_url: { url: `data:${img.mediaType};base64,${img.data}` } });
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST", signal, headers,
    body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, temperature: 0.9, messages: [{ role: "system", content: input.system }, { role: "user", content: userContent }] }),
  });
  if (!res.ok) throw new Error(`${cfg.provider} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return j.choices?.[0]?.message?.content ?? "";
}
