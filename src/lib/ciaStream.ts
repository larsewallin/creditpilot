/**
 * CIA v2: asks cia-agent with stream: true and reads its server-sent events —
 * step (progress in plain words), delta (answer text as written), reset (text written
 * before a web search is dropped), done (the final answer) and error.
 * The rate-limit reply comes back as plain JSON and is passed through as the answer.
 */
import { supabase } from "@/integrations/supabase/client";

export interface CiaStreamHandlers {
  onStep: (label: string) => void;
  onDelta: (text: string) => void;
  onReset: () => void;
}

export async function askCiaStream(body: Record<string, unknown>, h: CiaStreamHandlers, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cia-agent`;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const { data } = await supabase.auth.getSession();
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${data.session?.access_token ?? key}` },
    body: JSON.stringify({ ...body, stream: true }),
  });
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream") || !res.body) {
    const j = await res.json().catch(() => ({ error: `CIA is unavailable (${res.status})` }));
    if (!res.ok || j?.error) throw new Error(j?.error ?? `CIA is unavailable (${res.status})`);
    return j;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let cut: number;
    while ((cut = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const event = raw.match(/^event: (.+)$/m)?.[1];
      const dataLine = raw.match(/^data: (.*)$/m)?.[1];
      if (!event || dataLine === undefined) continue;
      let d: { label?: string; text?: string; error?: string } & Record<string, unknown>;
      try { d = JSON.parse(dataLine); } catch { continue; }
      if (event === "step") h.onStep(String(d.label ?? ""));
      else if (event === "delta") h.onDelta(String(d.text ?? ""));
      else if (event === "reset") h.onReset();
      else if (event === "done") return d;
      else if (event === "error") throw new Error(d.error ?? "Failed to generate answer");
    }
  }
  throw new Error("The answer stopped before it finished. Try again.");
}
