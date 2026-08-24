import type { Metadata } from "next";
import { Geist, Geist_Mono, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

/**
 * Render everything dynamically.
 *
 * This is a private, auth-gated, DB-backed internal ERP — no route benefits
 * from static generation, and every meaningful page already reads the session.
 * Declaring it here also avoids a static-export crash: `next-themes`'
 * ThemeProvider (in <Providers>) throws "Cannot read properties of null
 * (reading 'useContext')" when prerendered at build time under this
 * Next/React combination.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "ACT ERP",
    template: "%s · ACT ERP",
  },
  description:
    "American Completion Tools — internal workforce management platform.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // `dark` on <html> is the baseline so provider-less pages (the bare 404,
  // which is all Next renders for an unmatched route) still match the app's
  // default theme. Where ThemeProvider is mounted, next-themes' pre-paint
  // script replaces it with the user's actual choice.
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`dark ${geistSans.variable} ${geistMono.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      {/*
        No client-side providers here on purpose. Next prerenders its own
        synthetic pages (/_global-error, /_not-found) against this layout at
        build time, and React hooks throw during that pass — which is what
        broke `next build`. Providers live in the route-group layouts instead;
        see src/components/providers.tsx.
      */}
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}
