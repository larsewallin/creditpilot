import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * The date the screens age invoices and payments against: on the public demo, the day the
 * demo was built (so the customer panel agrees with AR Aging and the alerts at any hour and
 * in any time zone); elsewhere, the database's today. Falls back to the visitor's date until
 * it loads. Returns "YYYY-MM-DD".
 */
export function useAppToday(): string {
  const local = new Date();
  const fallback = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
  const { data } = useQuery({
    queryKey: ["app-today"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await (supabase as any).from("v_app_today").select("today").maybeSingle();
      return (data?.today as string | undefined) ?? null;
    },
  });
  return data ?? fallback;
}

/** Whole days from `isoDate` to `today` (both "YYYY-MM-DD"): positive when isoDate is earlier. */
export function daysBetween(isoDate: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}
