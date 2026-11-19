import { describe, expect, it } from "vitest";
import { streamClaude, WEB_SEARCH_TOOL } from "../../../claude_stream.ts";

const sse = (events: unknown[]) => events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join("");
function fakeFetch(bodies: Array<{ status: number; text: string }>) {
  const calls: any[] = [];
  const f = (async (_url: string, init: any) => {
    calls.push(JSON.parse(init.body));
    const b = bodies.shift()!;
    // split mid-event to check the buffering
    const chunks = [b.text.slice(0, 37), b.text.slice(37)];
    const stream = new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); } });
    return new Response(b.status === 200 ? stream : b.text, { status: b.status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("streamClaude", () => {
  it("streams text, steps for a web search, drops the preamble, numbers cited pages", async () => {
    const events = [
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me search." } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "server_tool_use", id: "s1", name: "web_search", input: {} } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"query\":\"Boeing " } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "strike\"}" } },
      { type: "content_block_stop", index: 1 },
      { type: "content_block_start", index: 2, content_block: { type: "web_search_tool_result", content: [{}, {}, {}] } },
      { type: "content_block_stop", index: 2 },
      { type: "content_block_start", index: 3, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 3, delta: { type: "text_delta", text: "Exposure is $2M [C1]. " } },
      { type: "content_block_stop", index: 3 },
      { type: "content_block_start", index: 4, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 4, delta: { type: "citations_delta", citation: { type: "web_search_result_location", url: "https://a.com/x", title: "A", cited_text: "strike" } } },
      { type: "content_block_delta", index: 4, delta: { type: "text_delta", text: "Workers are on strike" } },
      { type: "content_block_stop", index: 4 },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ];
    const { f, calls } = fakeFetch([{ status: 200, text: sse(events) }]);
    const steps: string[] = []; let resets = 0; let streamed = "";
    const r = await streamClaude("k", { model: "m", max_tokens: 10, system: "s", messages: [], tools: [WEB_SEARCH_TOOL] },
      { onStep: (s) => steps.push(s), onReset: () => { resets++; streamed = ""; }, onText: (t) => { streamed += t; } }, f);
    expect(calls[0].stream).toBe(true);
    expect(r.text).toBe("Exposure is $2M [C1]. Workers are on strike [W1]");
    expect(streamed).toBe(r.text);
    expect(resets).toBe(1);
    expect(steps).toEqual(["Searching the web: Boeing strike", "Reading 3 web results"]);
    expect(r.web).toEqual([{ url: "https://a.com/x", title: "A", cited_text: "strike" }]);
    expect(r.searches).toEqual(["Boeing strike"]);
    expect(r.stop_reason).toBe("end_turn");
  });

  it("answers without the web when the account cannot use web search", async () => {
    const ok = sse([
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "Hi" } },
      { type: "content_block_stop", index: 0 },
    ]);
    const { f, calls } = fakeFetch([{ status: 400, text: "{\"error\":{\"message\":\"web_search is not enabled\"}}" }, { status: 200, text: ok }]);
    const r = await streamClaude("k", { model: "m", max_tokens: 10, system: "s", messages: [], tools: [WEB_SEARCH_TOOL] }, {}, f);
    expect(r.text).toBe("Hi");
    expect(calls[1].tools).toBeUndefined();
  });
});
