import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/web/components/ThemeProvider";

export const metadata: Metadata = {
  title: "StockMind AI Terminal",
  description: "A professional AI-powered trading and financial analysis terminal.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased min-h-screen bg-white dark:bg-[#0B0E14] text-slate-800 dark:text-slate-300 selection:bg-blue-500/30">
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
