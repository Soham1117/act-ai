import { getPortalLanguage } from "@/lib/portal-i18n/server";
import { PortalLanguageProvider, PortalLanguageSwitch } from "@/components/portal-language";
import { Providers } from "@/components/providers";

// /auth/forgot-password uses <ThemeToggle> (next-themes), so it needs the
// client providers that the root layout deliberately no longer supplies.
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { language } = await getPortalLanguage();
  return <Providers><PortalLanguageProvider language={language}><div className="fixed right-16 top-6 z-50"><PortalLanguageSwitch /></div>{children}</PortalLanguageProvider></Providers>;
}
