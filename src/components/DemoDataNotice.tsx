import { Info } from "lucide-react";
import { DEMO_MODE } from "@/lib/constants";

export function DemoDataNotice({ message }: { message: string }) {
  if (!DEMO_MODE) return null;
  return (
    <div className="flex items-start gap-2 text-xs text-muted-foreground bg-secondary/30 border rounded-lg px-3 py-2">
      <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <p>{message}</p>
    </div>
  );
}
