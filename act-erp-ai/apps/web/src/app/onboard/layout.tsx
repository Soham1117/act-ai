import { Providers } from "@/components/providers";

// The onboarding wizard raises toasts (sonner), so it needs the client
// providers that the root layout deliberately no longer supplies.
export default function OnboardLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
