import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { RiskTierBadge } from "@/components/RiskTierBadge";
import { formatCurrency, formatPct, relativeTime } from "@/lib/format";
import { SkeletonCard, SkeletonTable } from "@/components/SkeletonCard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Upload } from "lucide-react";
import { useState, useRef } from "react";
import { toast } from "sonner";
import { DEMO_MODE } from "@/lib/constants";

// ── Types ────────────────────────────────────────────────────────────────────

interface UploadResult {
  inserted: number;
  skipped_rows: number;
  errors: { row: number; message: string }[];
  unmatched_customers: string[];
  column_map: Record<string, string>;
  validation_warnings: { row: number; field: string; message: string }[];
  currency_warnings: { row: number; invoice_number: string; invoice_currency: string; expected_currency: string }[];
}

interface MappingState {
  available_columns: string[];
  unmapped: string[];
  current_map: Record<string, string>;
}

const REQUIRED_FIELDS = [
  { key: "invoice_number",    label: "Invoice Number" },
  { key: "customer_name",     label: "Customer Name" },
  { key: "invoice_date",      label: "Invoice Date" },
  { key: "due_date",          label: "Due Date" },
  { key: "outstanding_amount", label: "Outstanding Amount" },
];

// ── Main component ───────────────────────────────────────────────────────────

export default function ArAging() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  // Upload dialog state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadStep, setUploadStep] = useState<"pick" | "mapping" | "success">("pick");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [mappingState, setMappingState] = useState<MappingState | null>(null);
  const [manualMap, setManualMap] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().split("T")[0]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: portfolio, isLoading: pLoading, refetch: refetchPortfolio } = useQuery({
    queryKey: ["ar-portfolio"],
    queryFn: async () => {
      const { data } = await supabase.from("v_ar_aging_portfolio").select("*").single();
      return data;
    },
  });

  const { data: customers, isLoading: cLoading, refetch: refetchCustomers } = useQuery({
    queryKey: ["ar-aging-customers"],
    queryFn: async () => {
      const { data } = await supabase.from("v_ar_aging_current").select("*").order("total_outstanding", { ascending: false });
      return data ?? [];
    },
  });

  const { data: actions } = useQuery({
    queryKey: ["ar-aging-actions"],
    queryFn: async () => {
      const { data } = await supabase
        .from("pending_actions")
        .select("*, customers!inner(company_name, ticker)")
        .eq("agent_name", "ar_aging_agent")
        .eq("status", "pending")
        .eq("is_demo", true)
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const { error } = await supabase.rpc("fn_refresh_all_ar_aging", { p_as_of: new Date().toISOString().split("T")[0] });
      if (error) throw error;
      await Promise.all([refetchPortfolio(), refetchCustomers()]);
      toast.success("AR aging refreshed");
    } catch { toast.error("Failed to refresh"); }
    setRefreshing(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setUploadFile(file);
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);

    try {
      const resolvedMap = mappingState
        ? { ...mappingState.current_map, ...manualMap }
        : undefined;

      const form = new FormData();
      form.append("file", uploadFile);
      if (resolvedMap) form.append("column_map", JSON.stringify(resolvedMap));
      form.append("is_demo", String(DEMO_MODE));
      form.append("as_of_date", reportDate);

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ar-csv-upload`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
          body: form,
        }
      );

      const json = await res.json();

      if (res.status === 422 && json.unmapped_columns) {
        // Needs manual column mapping
        setMappingState({
          available_columns: json.available_columns ?? [],
          unmapped: json.unmapped_columns,
          current_map: json.column_map ?? {},
        });
        const initMap: Record<string, string> = {};
        for (const f of json.unmapped_columns) initMap[f] = "";
        setManualMap(initMap);
        setUploadStep("mapping");
        setUploading(false);
        return;
      }

      if (!res.ok) {
        toast.error(json.error ?? "Upload failed");
        setUploading(false);
        return;
      }

      setUploadResult(json);
      setUploadStep("success");
      await Promise.all([refetchPortfolio(), refetchCustomers()]);
      queryClient.invalidateQueries({ queryKey: ["customer-invoices"] });
    } catch (err) {
      toast.error((err as Error).message);
    }

    setUploading(false);
  };

  const handleDialogClose = () => {
    setUploadOpen(false);
    setUploadStep("pick");
    setUploadFile(null);
    setMappingState(null);
    setManualMap({});
    setUploadResult(null);
    setReportDate(new Date().toISOString().split("T")[0]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Portfolio bar data ─────────────────────────────────────────────────────

  const total = Number(portfolio?.total_outstanding) || 1;
  const segments = [
    { label: "Current", value: Number(portfolio?.total_current) || 0, className: "bg-aging-current" },
    { label: "1–30", value: Number(portfolio?.total_1_30) || 0, className: "bg-aging-1-30" },
    { label: "31–60", value: Number(portfolio?.total_31_60) || 0, className: "bg-aging-31-60" },
    { label: "61–90", value: Number(portfolio?.total_61_90) || 0, className: "bg-aging-61-90" },
    { label: "90+", value: Number(portfolio?.total_over_90) || 0, className: "bg-aging-over-90" },
  ];

  if (pLoading) return <div className="space-y-4"><SkeletonCard /><SkeletonTable /></div>;

  return (
    <div className="space-y-6 pb-48">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">AR Aging</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)} className="h-8 text-xs gap-2">
            <Upload className="h-3 w-3" />
            Upload AR Data
          </Button>
          <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing} className="h-8 text-xs gap-2">
            <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
            Refresh Aging
          </Button>
        </div>
      </div>

      {/* Portfolio Bar */}
      <div className="bg-card rounded-xl border p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Portfolio Aging</h2>
        <div className="flex h-8 rounded-lg overflow-hidden">
          {segments.map((s) => {
            const pct = total > 0 ? (s.value / total) * 100 : 0;
            if (pct === 0) return null;
            return (
              <div key={s.label} className={`${s.className} relative`} style={{ width: `${pct}%` }} title={`${s.label}: ${formatCurrency(s.value)}`} />
            );
          })}
        </div>
        <div className="flex flex-wrap mt-3 gap-x-6 gap-y-2">
          {segments.map((s) => (
            <div key={s.label} className="text-xs">
              <div className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${s.className}`} />
                <span className="text-muted-foreground">{s.label}</span>
              </div>
              <p className="font-semibold text-foreground ml-4">{formatCurrency(s.value)}</p>
              <p className="text-muted-foreground ml-4">{total > 0 ? ((s.value / total) * 100).toFixed(1) : 0}%</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-6">
        {/* Customer Table */}
        <div className="flex-1 min-w-0">
          {cLoading ? <SkeletonTable rows={10} /> : (
            <div className="bg-card rounded-xl border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-secondary/50 sticky top-0">
                    <tr className="text-muted-foreground">
                      <th className="text-left p-3 font-medium whitespace-nowrap">Customer</th>
                      <th className="text-left p-3 font-medium">Risk</th>
                      <th className="text-right p-3 font-medium whitespace-nowrap">Current</th>
                      <th className="text-right p-3 font-medium whitespace-nowrap">1–30</th>
                      <th className="text-right p-3 font-medium whitespace-nowrap">31–60</th>
                      <th className="text-right p-3 font-medium whitespace-nowrap">61–90</th>
                      <th className="text-right p-3 font-medium whitespace-nowrap">90+</th>
                      <th className="text-right p-3 font-medium whitespace-nowrap">Total AR</th>
                      <th className="text-right p-3 font-medium whitespace-nowrap">Util%</th>
                      <th className="text-right p-3 font-medium whitespace-nowrap">DSO</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(customers ?? []).filter(c => Number(c.total_outstanding) > 0).map((c: any) => (
                      <tr key={c.id} className="hover:bg-secondary/30">
                        <td className="p-3">
                          <span className="font-medium text-foreground">{c.company_name}</span>
                          <span className="text-muted-foreground ml-1.5 text-[10px]">{c.ticker}</span>
                        </td>
                        <td className="p-3"><RiskTierBadge tier={c.risk_tier} /></td>
                        <td className="p-3 text-right font-mono tabular-nums">{formatCurrency(c.current_amount)}</td>
                        <td className="p-3 text-right font-mono tabular-nums">{formatCurrency(c.bucket_1_30)}</td>
                        <td className="p-3 text-right font-mono tabular-nums">{formatCurrency(c.bucket_31_60)}</td>
                        <td className="p-3 text-right font-mono tabular-nums">{formatCurrency(c.bucket_61_90)}</td>
                        <td className="p-3 text-right font-mono tabular-nums">{formatCurrency(c.bucket_over_90)}</td>
                        <td className="p-3 text-right font-mono tabular-nums font-semibold">{formatCurrency(c.total_outstanding)}</td>
                        <td className="p-3 text-right font-mono tabular-nums">{formatPct(c.utilization_pct)}</td>
                        <td className="p-3 text-right font-mono tabular-nums">{c.dso_days ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar - recent actions */}
        <div className="w-64 shrink-0">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Recent Agent Actions</h2>
          <div className="space-y-2">
            {(actions ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No recent agent actions. Actions will appear here after the AR Aging agent runs.</p>
            ) : (
              (actions ?? []).map((a: any) => (
                <div key={a.id} className="bg-card rounded-lg border p-3 border-l-4 border-l-agent-aging">
                  <p className="text-[10px] text-muted-foreground">{relativeTime(a.created_at)}</p>
                  <p className="text-xs font-medium text-foreground">{(a.customers as any).company_name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{a.action_type.replace(/_/g, " ")}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{a.rationale}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={(open) => { if (!open) handleDialogClose(); }}>
        <DialogContent className="sm:max-w-md">
          {uploadStep === "pick" && (
            <>
              <DialogHeader>
                <DialogTitle>Upload AR Data</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <p className="text-xs text-muted-foreground">
                  Upload a CSV export from your ERP. Column headers are auto-detected.
                  Open and overdue invoices for matched customers will be replaced.
                </p>
                <div
                  className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-foreground/40 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {uploadFile ? uploadFile.name : "Click to select a CSV file"}
                  </p>
                  {uploadFile && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {(uploadFile.size / 1024).toFixed(1)} KB
                    </p>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Report date</label>
                  <input
                    type="date"
                    value={reportDate}
                    onChange={(e) => setReportDate(e.target.value)}
                    className="w-full h-8 rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <p className="text-[10px] text-muted-foreground">Used to calculate days overdue. Defaults to today.</p>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Accepted columns: Invoice Number, Customer Name, Invoice Date, Due Date,
                  Amount, Outstanding, Currency, Days Overdue — and common aliases.
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={handleDialogClose}>Cancel</Button>
                <Button size="sm" onClick={handleUpload} disabled={!uploadFile || uploading}>
                  {uploading ? "Uploading…" : "Upload"}
                </Button>
              </DialogFooter>
            </>
          )}

          {uploadStep === "mapping" && mappingState && (
            <>
              <DialogHeader>
                <DialogTitle>Map Columns</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <p className="text-xs text-muted-foreground">
                  Some required columns couldn't be auto-detected. Match them to your CSV headers below.
                </p>
                {mappingState.unmapped.map((field) => {
                  const fieldDef = REQUIRED_FIELDS.find((f) => f.key === field);
                  return (
                    <div key={field} className="flex items-center gap-3">
                      <span className="text-xs font-medium w-36 shrink-0">{fieldDef?.label ?? field}</span>
                      <Select
                        value={manualMap[field] ?? ""}
                        onValueChange={(val) => setManualMap((m) => ({ ...m, [field]: val }))}
                      >
                        <SelectTrigger className="h-8 text-xs flex-1">
                          <SelectValue placeholder="Select column…" />
                        </SelectTrigger>
                        <SelectContent>
                          {mappingState.available_columns.map((col) => (
                            <SelectItem key={col} value={col} className="text-xs">{col}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setUploadStep("pick")}>Back</Button>
                <Button
                  size="sm"
                  onClick={handleUpload}
                  disabled={uploading || mappingState.unmapped.some((f) => !manualMap[f])}
                >
                  {uploading ? "Uploading…" : "Upload"}
                </Button>
              </DialogFooter>
            </>
          )}

          {uploadStep === "success" && uploadResult && (
            <>
              <DialogHeader>
                <DialogTitle>Upload Complete</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-secondary/50 rounded-lg p-3">
                    <p className="text-[10px] text-muted-foreground uppercase">Invoices Imported</p>
                    <p className="text-2xl font-bold text-foreground">{uploadResult.inserted}</p>
                  </div>
                  <div className="bg-secondary/50 rounded-lg p-3">
                    <p className="text-[10px] text-muted-foreground uppercase">Rows Skipped</p>
                    <p className="text-2xl font-bold text-foreground">{uploadResult.skipped_rows}</p>
                  </div>
                </div>
                {uploadResult.unmatched_customers.length > 0 && (
                  <div className="bg-secondary/30 rounded-lg p-3">
                    <p className="text-xs font-medium mb-1">Unmatched customers</p>
                    <p className="text-[10px] text-muted-foreground">
                      {uploadResult.unmatched_customers.join(", ")}
                    </p>
                  </div>
                )}
                {uploadResult.errors.length > 0 && (
                  <div className="bg-secondary/30 rounded-lg p-3 max-h-32 overflow-y-auto">
                    <p className="text-xs font-medium mb-1">Row errors</p>
                    {uploadResult.errors.slice(0, 10).map((e) => (
                      <p key={e.row} className="text-[10px] text-muted-foreground">Row {e.row}: {e.message}</p>
                    ))}
                    {uploadResult.errors.length > 10 && (
                      <p className="text-[10px] text-muted-foreground">…and {uploadResult.errors.length - 10} more</p>
                    )}
                  </div>
                )}
                {(uploadResult.validation_warnings ?? []).length > 0 && (
                  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
                    <p className="text-xs font-medium text-yellow-600 dark:text-yellow-400 mb-1">
                      {uploadResult.validation_warnings.length} row{uploadResult.validation_warnings.length !== 1 ? "s" : ""} with warnings — review before approving
                    </p>
                    {uploadResult.validation_warnings.slice(0, 5).map((w, i) => (
                      <p key={i} className="text-[10px] text-muted-foreground">Row {w.row} ({w.field}): {w.message}</p>
                    ))}
                    {uploadResult.validation_warnings.length > 5 && (
                      <p className="text-[10px] text-muted-foreground">…and {uploadResult.validation_warnings.length - 5} more</p>
                    )}
                  </div>
                )}
                {(uploadResult.currency_warnings ?? []).length > 0 && (
                  <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
                    <p className="text-xs font-medium text-orange-600 dark:text-orange-400 mb-1">
                      {uploadResult.currency_warnings.length} invoice{uploadResult.currency_warnings.length !== 1 ? "s" : ""} with currency mismatch — verify credit limit currency
                    </p>
                    {uploadResult.currency_warnings.slice(0, 5).map((w, i) => (
                      <p key={i} className="text-[10px] text-muted-foreground">{w.invoice_number}: {w.invoice_currency} (expected {w.expected_currency})</p>
                    ))}
                    {uploadResult.currency_warnings.length > 5 && (
                      <p className="text-[10px] text-muted-foreground">…and {uploadResult.currency_warnings.length - 5} more</p>
                    )}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button size="sm" onClick={handleDialogClose}>Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
