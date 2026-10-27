"use client";

import { createContext, useContext, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Languages, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createPortalTranslator, type PortalLanguage } from "@/lib/portal-i18n/core";
import { setPortalLanguage } from "@/server/actions/portal-language";
import type { ActionOk, ActionResult } from "@/lib/action-result";

const LanguageContext = createContext<PortalLanguage>("en");

export function PortalLanguageProvider({ language, children }: { language: PortalLanguage; children: React.ReactNode }) {
  return <LanguageContext.Provider value={language}><div lang={language} className="contents">{children}</div></LanguageContext.Provider>;
}

/** Defaults to English outside the employee/auth shell, preserving the admin interface. */
export function usePortalLanguage() {
  const language = useContext(LanguageContext);
  return useMemo(() => {
    const translator = createPortalTranslator(language);
    return { ...translator, toastAction<T extends Record<string, unknown>>(result: ActionResult<T>): result is ActionOk<T> {
      if (result.ok) return true;
      toast.error(translator.errorMessage(result));
      return false;
    } };
  }, [language]);
}

export function PortalLanguageSwitch() {
  const { language, t } = usePortalLanguage();
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs" disabled={pending}
    aria-label={t("common.changeLanguage")} onClick={() => startTransition(async () => {
      const result = await setPortalLanguage(language === "en" ? "es" : "en");
      if (!result.ok) { toast.error(t("common.languageSaveFailed")); return; }
      router.refresh();
    })}>
    {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />}
    <span lang={language === "en" ? "es" : "en"}>{language === "en" ? "Español" : "English"}</span>
  </Button>;
}
