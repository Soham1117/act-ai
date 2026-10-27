import { getPortalLanguage } from "@/lib/portal-i18n/server";
import { PortalLanguageProvider, PortalLanguageSwitch } from "@/components/portal-language";
import { Providers } from "@/components/providers";

// Standalone (outside the employee/admin shells) so the forced password
// change can't redirect-loop through those layouts. Needs client providers
// for toasts.
export default async function ChangePasswordLayout({ children }: { children: React.ReactNode }) {
  const { language } = await getPortalLanguage();
  return <Providers><PortalLanguageProvider language={language}><div className="fixed right-4 top-4 z-50"><PortalLanguageSwitch /></div>{children}</PortalLanguageProvider></Providers>;
}
