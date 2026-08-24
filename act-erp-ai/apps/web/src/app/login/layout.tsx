import { Providers } from "@/components/providers";

// The login page uses <ThemeToggle> (next-themes) and toasts, so it needs the
// client providers that the root layout deliberately no longer supplies.
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
