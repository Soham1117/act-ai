import { getPortalLanguage } from "@/lib/portal-i18n/server";
import { PortalLanguageProvider } from "@/components/portal-language";
import { AuthToolbar } from "@/components/auth-toolbar";
import { Providers } from "@/components/providers";

// Theme toggle + toasts need client providers the root layout omits on purpose.
export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  const { language } = await getPortalLanguage();
  return (
    <Providers>
      <PortalLanguageProvider language={language}>
        <div className="flex min-h-screen flex-col">
          <AuthToolbar />
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </div>
      </PortalLanguageProvider>
    </Providers>
  );
}
