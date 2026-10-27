"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ActionOk, ActionResult } from "@/lib/action-result";
import { translateKiosk } from "@/lib/kiosk-translations";

type Language = "en" | "es";
const STORAGE_KEY = "act-kiosk-language";
const LanguageContext = createContext<{
  language: Language;
  setLanguage: (language: Language) => void;
} | null>(null);

export function KioskLanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (localStorage.getItem(STORAGE_KEY) === "es") setLanguageState("es");
      } catch {
        /* The switch still works when storage is unavailable. */
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* Optional persistence. */
    }
  }, []);
  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      <div lang={language}>{children}</div>
    </LanguageContext.Provider>
  );
}

export function useKioskLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("KioskLanguageProvider is required");
  const { language } = context;
  const t = useCallback((text: string) => translateKiosk(text, language), [language]);
  const toastAction = useCallback(
    function toastAction<T extends Record<string, unknown>>(
      result: ActionResult<T>,
    ): result is ActionOk<T> {
      if (result.ok) return true;
      toast.error(
        t(
          result.error ||
            "Something went wrong. Try again, or contact an admin if it keeps happening.",
        ),
      );
      return false;
    },
    [t],
  );
  return { ...context, locale: language === "es" ? "es-US" : "en-US", t, toastAction };
}

export function KioskLanguageSwitch() {
  const { language, setLanguage } = useKioskLanguage();
  return (
    <div
      role="group"
      aria-label="Language / Idioma"
      className="flex shrink-0 gap-1 rounded-md border bg-background p-1"
    >
      {(["en", "es"] as const).map((value) => (
        <Button
          key={value}
          type="button"
          size="sm"
          lang={value}
          aria-pressed={language === value}
          variant={language === value ? "secondary" : "ghost"}
          className="h-10 px-3"
          onClick={() => setLanguage(value)}
        >
          {value === "en" ? "English" : "Español"}
        </Button>
      ))}
    </div>
  );
}
