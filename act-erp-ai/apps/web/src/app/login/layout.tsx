import { getPortalLanguage } from "@/lib/portal-i18n/server";
import { PortalLanguageProvider, PortalLanguageSwitch } from "@/components/portal-language";
import { Providers } from "@/components/providers";

// The login page uses <ThemeToggle> (next-themes) and toasts, so it needs the
// client providers that the root layout deliberately no longer supplies.
export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  const { language } = await getPortalLanguage();
  return <Providers><PortalLanguageProvider language={language}><div className="fixed right-4 top-4 z-50"><PortalLanguageSwitch /></div>{children}</PortalLanguageProvider></Providers>;
}
