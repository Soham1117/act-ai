import { Providers } from "@/components/providers";

// Public page, reachable without an account — but still uses the theme
// toggle, so it needs the client providers the root layout deliberately no
// longer supplies.
export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
