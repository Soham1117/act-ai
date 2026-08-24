import { Providers } from "@/components/providers";

// /auth/forgot-password uses <ThemeToggle> (next-themes), so it needs the
// client providers that the root layout deliberately no longer supplies.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
