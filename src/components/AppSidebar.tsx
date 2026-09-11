import { Zap, Newspaper, BarChart2, FileSearch, Users, Wrench, Info, Github } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const navItems = [
  { title: "Credit Events", path: "/events", icon: Zap },
  { title: "Actions", path: "/actions", icon: Wrench },
  { title: "AR Aging", path: "/aging", icon: BarChart2 },
  { title: "News Monitor", path: "/news", icon: Newspaper },
  { title: "SEC Filings", path: "/sec", icon: FileSearch },
  { title: "Customers", path: "/customers", icon: Users },
];

export function AppSidebar() {
  const { data: company } = useQuery({
    queryKey: ["company"],
    queryFn: async () => {
      const { data } = await supabase.from("company").select("name").limit(1).single();
      return data;
    },
  });

  return (
    <aside className="w-64 h-screen overflow-y-auto bg-sidebar flex flex-col shrink-0">
      <div className="p-5 border-b border-sidebar-border">
        <h1 className="text-sidebar-foreground font-semibold text-base">CreditPilot</h1>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-foreground font-medium"
                  : "text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="flex-1">{item.title}</span>
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-sidebar-border space-y-1">
        <NavLink
          to="/about"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors w-full"
        >
          <Info className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">What is this?</span>
        </NavLink>
        <a
          href="https://github.com/larsewallin/creditpilot"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors w-full"
        >
          <Github className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">GitHub</span>
        </a>
        <p className="text-sidebar-muted text-xs px-3">{company?.name ?? "Loading..."}</p>
      </div>
    </aside>
  );
}
