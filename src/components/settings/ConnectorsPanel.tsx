/**
 * Settings › Connectors: every data source CreditPilot reads, grouped by kind, with its
 * status on this installation. The server reports only whether each setting is present.
 */
import type { ConnectorInfo, SettingsAnswer } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

const STATUS: Record<ConnectorInfo["status"], { label: string; cls: string }> = {
  connected: { label: "Connected", cls: "bg-emerald-500/10 text-emerald-700" },
  default: { label: "Connected (hosted default)", cls: "bg-emerald-500/10 text-emerald-700" },
  built_in: { label: "Built in", cls: "bg-emerald-500/10 text-emerald-700" },
  manual: { label: "Entered by your team", cls: "bg-sky-500/10 text-sky-700" },
  not_set: { label: "Not connected", cls: "bg-amber-500/10 text-amber-800" },
  planned: { label: "Coming", cls: "bg-secondary text-muted-foreground" },
};

export function ConnectorsPanel({ data }: { data: SettingsAnswer }) {
  const connectors = data.connectors ?? [];
  const categories = data.connector_categories ?? [];
  const lists = data.sanctions_lists ?? [];
  const lastSync = lists.map((l) => l.last_success_at).filter(Boolean).sort()[0];
  const needed = connectors.filter((c) => c.status === "not_set" && !c.optional);

  return (
    <div className="space-y-4 text-xs">
      <p className="text-muted-foreground">
        Every agent writes its findings in the same format, so a new data source plugs in without changing the rest of the app: the
        events, actions and the assistant pick it up straight away. Below is what this installation reads today. You can replace any
        source with your own provider, for example D&amp;B for company data or your own rating provider for scores.
      </p>
      {data.demo && (
        <p className="rounded-md bg-amber-500/10 text-amber-800 px-2 py-1">
          This is the demo: sources marked "sample data" read the demo's invented data instead. New customers, sanctions screening and
          Keen use the real sources.
        </p>
      )}
      {!data.demo && needed.length > 0 && (
        <p className="rounded-md bg-amber-500/10 text-amber-800 px-2 py-1">
          {needed.length} source{needed.length > 1 ? "s" : ""} not connected yet: {needed.map((c) => c.name).join(", ")}. The agents that
          read them skip that part until it is connected.
        </p>
      )}

      {categories.map((cat) => {
        const rows = connectors.filter((c) => c.category === cat.key);
        if (!rows.length) return null;
        return (
          <section key={cat.key} className="bg-card rounded-xl border p-4 space-y-2">
            <div>
              <h2 className="text-sm font-semibold">{cat.label}</h2>
              <p className="text-muted-foreground">{cat.blurb}</p>
            </div>
            <ul className="divide-y divide-border rounded-lg border">
              {rows.map((c) => {
                const st = STATUS[c.status];
                return (
                  <li key={c.key} className="px-3 py-2 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground">{c.name}</span>
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", st.cls)}>{st.label}</span>
                      {data.demo && c.demo_sample && <span className="rounded px-1.5 py-0.5 text-[10px] bg-secondary text-muted-foreground">sample data in the demo</span>}
                      {c.optional && c.status === "not_set" && <span className="text-[10px] text-muted-foreground">optional</span>}
                    </div>
                    <p className="text-muted-foreground">{c.feeds}</p>
                    {c.key === "sanctions_lists" && lists.length > 0 && (
                      <p className="text-muted-foreground">{lists.length} lists, oldest refresh {lastSync ? new Date(lastSync).toLocaleString() : "never"}.</p>
                    )}
                    {c.status === "not_set" && c.missing.length > 0 && (
                      <p className="text-muted-foreground">To connect: add {c.missing.map((n, i) => <span key={n}>{i > 0 && ", "}<code className="font-mono">{n}</code></span>)} to your installation's function secrets (see Run it yourself in the GitHub repo).</p>
                    )}
                    {c.code && <p className="text-[10px] text-muted-foreground/80">For developers: {c.code}</p>}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
