import { describe, it, expect } from "vitest";
import { jaroWinkler, soundex, similarity, matchSanctionsName, prepareSanctionsList } from "../match-sanctions-name.ts";

describe("string measures", () => {
  it("matches published Jaro-Winkler reference values", () => {
    expect(jaroWinkler("martha", "marhta").toFixed(3)).toBe("0.961");
    expect(jaroWinkler("dixon", "dicksonx").toFixed(3)).toBe("0.813");
    expect(jaroWinkler("abc", "abc")).toBe(1);
  });
  it("produces standard Soundex codes", () => {
    expect(["robert", "rupert", "rubin", "ashcraft", "tymczak", "pfister"].map(soundex))
      .toEqual(["R163", "R163", "R150", "A261", "T522", "P236"]);
  });
});

describe("similarity", () => {
  it("catches transliteration variants (G05)", () => {
    const s = similarity("Dmitry Andreyevich Volkhovsky", "Dmitri Andreevich Volkhovsky");
    expect(s).toBeGreaterThanOrEqual(0.85);
  });
  it("catches swapped letters in short names", () => {
    expect(similarity("Ali Khan", "Ali Kahn")).toBeGreaterThanOrEqual(0.85);
  });
  it("ignores word order", () => {
    expect(similarity("Volkhovsky Dmitri", "Dmitri Volkhovsky")).toBeGreaterThanOrEqual(0.97);
  });
  it("ignores legal forms and case for entities", () => {
    expect(similarity("Kestrel Petrochem Trading FZE", "KESTREL PETROCHEM TRADING", "entity")).toBe(1);
  });
  it("tolerates an omitted patronymic or middle name", () => {
    expect(similarity("Viktor Vekselberg", "Viktor Feliksovich Vekselberg")).toBeGreaterThanOrEqual(0.97);
    expect(similarity("Ramzan Kadyrov", "Ramzan Akhmatovich Kadyrov")).toBeGreaterThanOrEqual(0.97);
  });
  it("does not let a shorter name equal a much longer list name", () => {
    expect(similarity("Maria Garcia", "Maria Del Rosario Garcia Duran")).toBeLessThan(0.95);
  });
  it("requires every word of the screened name to have a counterpart", () => {
    expect(similarity("John Smith", "John Numbi")).toBeLessThan(0.85);
    expect(similarity("Thomas Mueller", "Thomas Roper")).toBeLessThan(0.85);
    expect(similarity("John Paul Smith", "John Smith")).toBeGreaterThanOrEqual(0.85);
  });
  it("needs a near-exact match for one-word names", () => {
    expect(similarity("Tesco PLC", "TESA", "entity")).toBeLessThan(0.85);
    expect(similarity("Tesla Inc", "TESA", "entity")).toBeLessThan(0.85);
    expect(similarity("Rosoboronexport", "ROSOBORONEKSPORT OAO", "entity")).toBeGreaterThanOrEqual(0.85);
    expect(similarity("Gazprom", "GAZPROM PAO", "entity")).toBe(1);
  });
  it("keeps unrelated names below the review threshold", () => {
    expect(similarity("Karen Whitfield", "Rahim Golzari Tehrani")).toBeLessThan(0.85);
    expect(similarity("Lakeshore Industrial Supply Inc.", "Baltic Amber Logistics OOO", "entity")).toBeLessThan(0.85);
  });
});

describe("matchSanctionsName", () => {
  const list = prepareSanctionsList([
    { list: "OFAC_SDN", name: "Ivan Petrovich Sidorov", type: "person", aliases: ["Ivan Sidorov", "Ioann Sydorov"], country_code: "RU" },
    { list: "EU", name: "Sidorov Trading OOO", type: "entity", country_code: "RU" },
  ]);
  it("matches through an alias", () => {
    const m = matchSanctionsName("Ioann Sydorov", "person", list, 0.85);
    expect(m?.entry.name).toBe("Ivan Petrovich Sidorov");
    expect(m?.score).toBe(1);
  });
  it("only compares people with people and entities with entities", () => {
    expect(matchSanctionsName("Sidorov Trading", "person", list, 0.97)).toBe(null);
    expect(matchSanctionsName("Sidorov Trading LLC", "entity", list, 0.97)?.entry.list).toBe("EU");
  });
});
