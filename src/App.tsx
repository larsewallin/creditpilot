import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Outlet, Navigate } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { CIAChat } from "@/components/CIAChat";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { DEMO_MODE } from "@/lib/constants";
import { initDemo } from "@/lib/initDemo";
import { supabase } from "@/integrations/supabase/client";
import CreditEvents from "@/pages/CreditEvents";
import NewsMonitor from "@/pages/NewsMonitor";
import ArAging from "@/pages/ArAging";
import SecFilings from "@/pages/SecFilings";
import Customers from "@/pages/Customers";
import Actions from "@/pages/Actions";
import CIA from "@/pages/CIA";
import About from "@/pages/About";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function SidebarLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!DEMO_MODE) return;

    supabase
      .from("pending_actions")
      .select("*", { count: "exact", head: true })
      .eq("is_demo", true)
      .eq("status", "pending")
      .then(({ count }) => {
        if (!count || count < 5) {
          return initDemo().then(() => queryClient.invalidateQueries());
        }
      })
      .catch(() => {
        // silent — demo still works via manual run
      });
  }, []);

  return (
    <div className="flex h-screen w-full">
      <div className="hidden md:flex">
        <AppSidebar />
      </div>

      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <AppSidebar />
        </SheetContent>
      </Sheet>

      <main className="flex-1 p-6 overflow-auto">
        <Button
          size="icon"
          variant="ghost"
          className="md:hidden mb-4 h-8 w-8"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <Outlet />
      </main>
      <CIAChat />
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<SidebarLayout />}>
            <Route path="/" element={<Navigate to="/events" replace />} />
            <Route path="/events" element={<CreditEvents />} />
            <Route path="/actions" element={<Actions />} />
            <Route path="/demo" element={<Navigate to="/events" replace />} />
            <Route path="/news" element={<NewsMonitor />} />
            <Route path="/aging" element={<ArAging />} />
            <Route path="/sec" element={<SecFilings />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/cia" element={<CIA />} />
            <Route path="/about" element={<About />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
