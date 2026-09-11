// src/components/CIAChat.tsx
// CIA launcher bar — always visible at bottom, navigates to /cia?q=...

import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function CIAChat() {
  const [input, setInput] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const navigate = useNavigate();
  const location = useLocation();

  const isOnCIAPage = location.pathname === "/cia";

  // Fetch suggestions once, cache in sessionStorage
  useEffect(() => {
    const cached = sessionStorage.getItem("cia_suggestions");
    if (cached) {
      try { setSuggestions(JSON.parse(cached)); return; } catch {}
    }
    supabase.functions
      .invoke("cia-agent", { body: { mode: "suggestions" } })
      .then(({ data }) => {
        if (Array.isArray(data?.suggestions)) {
          setSuggestions(data.suggestions);
          sessionStorage.setItem("cia_suggestions", JSON.stringify(data.suggestions));
        }
      })
      .catch(() => {});
  }, []);

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setInput("");
    setIsOpen(false);
    navigate(`/cia?q=${encodeURIComponent(trimmed)}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); submit(input); }
    if (e.key === "Escape") { setIsOpen(false); }
  };

  const handleBlur = () => {
    // Delay so suggestion mousedown can fire first
    setTimeout(() => {
      if (!input.trim()) setIsOpen(false);
    }, 150);
  };

  // Prevent input blur when clicking a suggestion
  const handleSuggestionMouseDown = (e: React.MouseEvent, q: string) => {
    e.preventDefault();
    submit(q);
  };

  const placeholder = isOnCIAPage
    ? "Ask a follow-up…"
    : "Ask CIA anything about your portfolio…";

  return (
    <>
      {/* ── Fixed bottom bar ─────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-64 right-0 z-50 bg-background border-t border-border">
        {/* Suggestion list — expands upward */}
        {isOpen && suggestions.length > 0 && (
          <div className="max-w-3xl mx-auto px-4 pt-2 pb-1">
            <div className="rounded-xl border border-border bg-background overflow-hidden divide-y divide-border shadow-sm">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onMouseDown={e => handleSuggestionMouseDown(e, s)}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left hover:bg-secondary/60 transition-colors"
                >
                  <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-foreground truncate">{s}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input row */}
        <div className="max-w-3xl mx-auto px-4 py-2.5 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsOpen(true)}
              onBlur={handleBlur}
              placeholder={placeholder}
              className="w-full h-9 pl-9 pr-3 text-sm rounded-md border border-input bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <button
            onMouseDown={e => { e.preventDefault(); submit(input); }}
            disabled={!input.trim()}
            className={cn(
              "h-9 w-9 rounded-md flex items-center justify-center text-sm font-medium transition-colors shrink-0",
              input.trim()
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-secondary text-muted-foreground cursor-not-allowed"
            )}
            aria-label="Ask"
          >
            →
          </button>
        </div>
      </div>

      {/* Spacer — always h-14 */}
      <div className="h-14" />
    </>
  );
}
