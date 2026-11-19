/**
 * One streamed Messages API call (raw fetch: the SDK pinned in cia-agent predates server
 * tools), with Claude's own web search when asked for.
 *
 * - onText: each piece of answer text as it arrives.
 * - onStep: plain-language progress ("Searching the web: Boeing supply chain").
 * - onReset: text written before a web search ("I'll look that up…") is thrown away;
 *   the answer that counts starts after the search.
 * A text block that cites web pages ends with [W1] (numbered per page, first cited first),
 * the same way the portfolio data is cited with [E3]; `web` lists those pages.
 * If the account cannot use web search, the call is made again without it.
 */

export interface WebSource { url: string; title: string; cited_text: string }
export interface Usage { input_tokens: number; output_tokens: number; web_searches: number }
export interface StreamResult { text: string; stop_reason: string | null; web: WebSource[]; searches: string[]; usage: Usage }
export interface StreamHandlers {
  onText?: (t: string) => void;
  onStep?: (label: string) => void;
  onReset?: () => void;
}

export const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 2 };

export async function streamClaude(
  apiKey: string,
  body: { model: string; max_tokens: number; system: string; messages: unknown[]; tools?: unknown[] },
  h: StreamHandlers = {},
  fetchFn: typeof fetch = fetch,
): Promise<StreamResult> {
  const res = await fetchFn("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    // Web search not enabled for this account / model: answer from the data alone.
    if (body.tools?.length && res.status === 400 && /web_search|tool/i.test(detail)) {
      console.warn("[claude_stream] web search unavailable, answering without it:", detail.slice(0, 200));
      return streamClaude(apiKey, { ...body, tools: undefined }, h, fetchFn);
    }
    throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 300)}`);
  }

  const out: StreamResult = { text: "", stop_reason: null, web: [], searches: [], usage: { input_tokens: 0, output_tokens: 0, web_searches: 0 } };
  const webIndex = new Map<string, number>();
  // Per content block: its type, any tool input being streamed, and the web pages it cites.
  const blocks = new Map<number, { type: string; json: string; cites: number[] }>();

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
      const dataLine = raw.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      let ev: any;
      try { ev = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
      handle(ev);
    }
  }
  return out;

  function handle(ev: any) {
    switch (ev.type) {
      case "content_block_start": {
        const b = ev.content_block ?? {};
        blocks.set(ev.index, { type: b.type, json: "", cites: [] });
        if (b.type === "server_tool_use") {
          // Whatever was written before the search was a preamble.
          out.text = "";
          h.onReset?.();
        } else if (b.type === "web_search_tool_result") {
          const n = Array.isArray(b.content) ? b.content.length : 0;
          if (n) h.onStep?.(`Reading ${n} web results`);
        } else if (b.type === "text" && b.text) {
          out.text += b.text; h.onText?.(b.text);
        }
        break;
      }
      case "content_block_delta": {
        const d = ev.delta ?? {};
        const blk = blocks.get(ev.index);
        if (d.type === "text_delta") { out.text += d.text; h.onText?.(d.text); }
        else if (d.type === "input_json_delta" && blk) blk.json += d.partial_json ?? "";
        else if (d.type === "citations_delta" && blk && d.citation?.url) {
          const c = d.citation;
          let n = webIndex.get(c.url);
          if (n === undefined) {
            n = out.web.length + 1;
            webIndex.set(c.url, n);
            out.web.push({ url: c.url, title: String(c.title ?? c.url), cited_text: String(c.cited_text ?? "").replace(/\*\*|__|#+\s/g, "").slice(0, 400) });
          }
          if (!blk.cites.includes(n)) blk.cites.push(n);
        }
        break;
      }
      case "content_block_stop": {
        const blk = blocks.get(ev.index);
        if (blk?.type === "server_tool_use") {
          let q = "";
          try { q = String(JSON.parse(blk.json || "{}").query ?? ""); } catch { /* partial */ }
          if (q) { out.searches.push(q); h.onStep?.(`Searching the web: ${q}`); }
        } else if (blk?.type === "text" && blk.cites.length) {
          const tag = ` [${blk.cites.map((n) => `W${n}`).join(", ")}]`;
          out.text += tag; h.onText?.(tag);
        }
        break;
      }
      case "message_start": {
        const u = ev.message?.usage ?? {};
        out.usage.input_tokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
        break;
      }
      case "message_delta":
        if (ev.delta?.stop_reason) out.stop_reason = ev.delta.stop_reason;
        if (ev.usage) {
          // message_delta carries the final counts (input includes the web results read).
          if (typeof ev.usage.input_tokens === "number") out.usage.input_tokens = ev.usage.input_tokens + (ev.usage.cache_read_input_tokens ?? 0) + (ev.usage.cache_creation_input_tokens ?? 0);
          if (typeof ev.usage.output_tokens === "number") out.usage.output_tokens = ev.usage.output_tokens;
          out.usage.web_searches = ev.usage.server_tool_use?.web_search_requests ?? out.usage.web_searches;
        }
        break;
      case "error":
        throw new Error(`Anthropic stream error: ${ev.error?.message ?? "unknown"}`);
    }
  }
}
