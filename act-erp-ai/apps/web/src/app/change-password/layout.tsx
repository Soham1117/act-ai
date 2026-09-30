import { Providers } from "@/components/providers";

// Standalone (outside the employee/admin shells) so the forced password
// change can't redirect-loop through those layouts. Needs client providers
// for toasts.
export default function ChangePasswordLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
