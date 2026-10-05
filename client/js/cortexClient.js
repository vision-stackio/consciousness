export async function fetchHealth() {
    try {
        const r = await fetch("/api/health");
        return r.ok ? (await r.json()) : null;
    }
    catch {
        return null;
    }
}
/** Ask the server-side cortex (LLM) what to do next. Throws on any failure. */
export async function askCortex(request, frame) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
        const res = await fetch("/api/think", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ request, frame }), signal: ctrl.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok)
            throw new Error(data.error ?? `server ${res.status}`);
        return data.decision;
    }
    finally {
        clearTimeout(timer);
    }
}
