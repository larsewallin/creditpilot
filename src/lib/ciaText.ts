/** Text helpers for the CIA answer page (pure, tested in src/test/ciaStream.test.ts). */

/** The answer as it is being written: no citation tags or list markers yet, no half tag at the end. */
export function liveText(raw: string): string {
  return raw
    .replace(/\s*\[(?:[CIPNFEUMW]\d+(?:\s*[-–—]\s*[CIPNFEUMW]?\d+)?\s*,?\s*)+\]/g, "")
    .replace(/\{\{\s*[A-Z_]+\s*\}\}/g, "…")
    .replace(/\s*\[[^\]\n]*$/, "")
    .replace(/\{\{[^}]*$/, "");
}

/** "[1]" citations in the final answer become links the page renders as chips. */
export function linkCitations(answer: string): string {
  return answer.replace(/\[(\d{1,3})\](?!\()/g, "[$1](#cite-$1)");
}
