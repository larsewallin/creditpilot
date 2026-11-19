/**
 * A CIA conversation (thread): the questions and answers asked one after another on the CIA
 * page, kept in this browser tab (sessionStorage) under the thread id in the URL (?t=…).
 * Follow-ups stack on the page and the last few turns go to cia-agent as context.
 */
export interface ThreadTurn { question: string; answer: { answer: string } }

const KEY = (t: string) => `cia_thread_${t}`;
const MAX_TURNS = 12;

export function newThreadId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function getThread(t: string | null): ThreadTurn[] {
  if (!t) return [];
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY(t)) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

export function appendTurn(t: string, turn: ThreadTurn): void {
  try {
    const turns = getThread(t).filter((x) => x.question !== turn.question);
    sessionStorage.setItem(KEY(t), JSON.stringify([...turns, turn].slice(-MAX_TURNS)));
  } catch { /* storage full or off: the thread is just not kept */ }
}

/** The context sent with a follow-up: the last turns, answers without citation numbers, trimmed. */
export function historyFor(turns: ThreadTurn[], n = 3): { question: string; answer: string }[] {
  return turns.slice(-n).map((x) => ({
    question: x.question.slice(0, 500),
    answer: String(x.answer?.answer ?? "").replace(/\[\d{1,3}\]/g, "").slice(0, 800),
  }));
}
