import { describe, expect, it } from "vitest";
import { linkCitations, liveText } from "@/lib/ciaText";

describe("CIA streaming text", () => {
  it("hides tags, list markers and a half-written tag while streaming", () => {
    expect(liveText("Utilization is 92% [E3, C7] and **high** [W1].")).toBe("Utilization is 92% and **high**.");
    expect(liveText("Top risks:\n{{HIGH_RISK_LIST}}\nMore")).toBe("Top risks:\n…\nMore");
    expect(liveText("Exposure is $2M [C")).toBe("Exposure is $2M");
  });
  it("turns numbered citations into chip links, leaving real links alone", () => {
    expect(linkCitations("92%[1][2]. See [docs](https://x.com).")).toBe("92%[1](#cite-1)[2](#cite-2). See [docs](https://x.com).");
  });
});

import { appendTurn, getThread, historyFor } from "@/lib/ciaThread";
describe("CIA thread", () => {
  it("keeps turns per thread, replaces a repeated question, sends the last three trimmed", () => {
    sessionStorage.clear();
    appendTurn("t1", { question: "A?", answer: { answer: "x [1] y" } });
    appendTurn("t1", { question: "B?", answer: { answer: "b" } });
    appendTurn("t1", { question: "A?", answer: { answer: "x2" } });
    expect(getThread("t1").map((x) => x.question)).toEqual(["B?", "A?"]);
    expect(getThread("t2")).toEqual([]);
    expect(historyFor([{ question: "Q", answer: { answer: "see [12] here" } }])).toEqual([{ question: "Q", answer: "see  here" }]);
  });
});
