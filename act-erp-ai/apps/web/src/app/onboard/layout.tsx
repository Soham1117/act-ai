import { getPortalLanguage } from "@/lib/portal-i18n/server";
import { PortalLanguageProvider, PortalLanguageSwitch } from "@/components/portal-language";
import { Providers } from "@/components/providers";

// The onboarding wizard raises toasts (sonner), so it needs the client
// providers that the root layout deliberately no longer supplies.
export default async function OnboardLayout({ children }: { children: React.ReactNode }) {
  const { language } = await getPortalLanguage();
  return <Providers><PortalLanguageProvider language={language}><div className="fixed right-4 top-4 z-50"><PortalLanguageSwitch /></div>{children}</PortalLanguageProvider></Providers>;
}
