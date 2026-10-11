/**
 * Golden-prospect harness: 14 fictional applicants with outcomes fixed in
 * advance (see README.md and each fixture's "why"). Runs the real pipeline
 * core with fixture providers. Run with: node tests/onboarding/run.mjs
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { runOnboarding } from "../../supabase/functions/_shared/onboarding/pipeline.ts";
import { fixtureProviders } from "./providers.ts";
import { compare } from "./compare.ts";

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
const cases = readdirSync(FIX).filter((f) => /^G\d+\.json$/.test(f)).sort()
  .map((f) => JSON.parse(readFileSync(resolve(FIX, f), "utf8")));

describe("onboarding golden prospects", () => {
  for (const c of cases) {
    it(`${c.id} ${c.title}`, async () => {
      const outcome = await runOnboarding(c.application, fixtureProviders(c.sources), { asOf: c.as_of });
      const diffs = compare(outcome, c.expect);
      expect(diffs, diffs.join("\n")).toEqual([]);
    });
  }
});
