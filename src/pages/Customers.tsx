import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ScenarioBadge } from "@/components/ScenarioBadge";
import { formatCurrency, scoreColor } from "@/lib/format";
import { SkeletonTable } from "@/components/SkeletonCard";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { CustomerDetail } from "@/components/CustomerDetail";
import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";

// ── Main component ────────────────────────────────────────────────────────────

export default function Customers() {
  const [search, setSearch] = useState("");
  const [scenarioFilter, setScenarioFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const customerIdParam = searchParams.get("customer_id");

  const { data: customers, isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("customers")
        .select("*")
        .order("company_name");
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!customerIdParam || !customers) return;
    if (customers.some((c) => c.id === customerIdParam)) setSelectedId(customerIdParam);
  }, [customerIdParam, customers]);

  const selectedCustomer = customers?.find((c) => c.id === selectedId);

  const filtered = (customers ?? []).filter((c: any) => {
    if (search && !c.company_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (scenarioFilter !== "all" && c.scenario !== scenarioFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6 pb-48">
      <h1 className="text-xl font-semibold text-foreground">Customers</h1>

      <div className="flex gap-3">
        <Input placeholder="Search customers..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-64 h-8 text-xs" />
        <Select value={scenarioFilter} onValueChange={setScenarioFilter}>
          <SelectTrigger className="w-52 h-8 text-xs"><SelectValue placeholder="All risk categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All risk categories</SelectItem>
            <SelectItem value="normal_operations">Normal</SelectItem>
            <SelectItem value="payment_issues">Payment Issues</SelectItem>
            <SelectItem value="credit_deterioration">Credit Deterioration</SelectItem>
            <SelectItem value="negative_news">Negative News</SelectItem>
            <SelectItem value="bankruptcy">Bankruptcy</SelectItem>
            <SelectItem value="growth_opportunity">Growth</SelectItem>
            <SelectItem value="sec_filing_monitoring">SEC Monitoring</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? <SkeletonTable rows={15} /> : (
        <div className="bg-card rounded-xl border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-secondary/50 sticky top-0">
              <tr className="text-muted-foreground">
                <th className="text-left p-3 font-medium">Company</th>
                <th className="text-left p-3 font-medium">Risk Category</th>
                <th className="text-right p-3 font-medium">Credit Limit</th>
                <th className="text-right p-3 font-medium">Exposure</th>
                <th className="text-right p-3 font-medium">Util%</th>
                <th className="text-right p-3 font-medium">Credit Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((c: any) => {
                const util = c.credit_limit > 0 ? (c.current_exposure / c.credit_limit) * 100 : 0;
                const score = c.credit_rating_score as number | null;
                return (
                  <tr key={c.id} className="hover:bg-secondary/30 cursor-pointer" onClick={() => setSelectedId(c.id)}>
                    <td className="p-3">
                      <span className="font-medium">{c.company_name}</span>
                    </td>
                    <td className="p-3"><ScenarioBadge scenario={c.scenario} /></td>
                    <td className="p-3 text-right">{formatCurrency(c.credit_limit)}</td>
                    <td className="p-3 text-right">{formatCurrency(c.current_exposure)}</td>
                    <td className="p-3 text-right">{util.toFixed(1)}%</td>
                    <td className={cn("p-3 text-right font-medium", scoreColor(score))}>
                      {score != null ? score : <span className="text-muted-foreground font-normal">NR</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Customer Detail Drawer */}
      <Sheet open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
          {selectedCustomer && <CustomerDetail customer={selectedCustomer} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
