import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "supabase/functions/_shared/skills/**/*.{test,spec}.{ts,tsx}",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Supabase Edge Functions run on Deno, where importing a library
      // straight from a URL is normal (see e.g. fetch-sec-filing.ts,
      // search-news.ts). Node's ESM loader (what Vitest runs on) can't
      // resolve an https:// import at all, so tests that pull in a file
      // with this import fail before any test body runs. This alias only
      // affects local/CI test resolution — the deployed Edge Function
      // still uses the real esm.sh URL under Deno at runtime.
      "https://esm.sh/@supabase/supabase-js@2": "@supabase/supabase-js",
    },
  },
});
