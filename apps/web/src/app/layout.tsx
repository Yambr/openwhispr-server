import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenWhispr",
  description: "OpenWhispr Server web console",
};

// TODO(plan-06): wrap children with QueryClientProvider, I18nProvider, and
// Better Auth session provider per Phase 07.1 Plan 06.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
