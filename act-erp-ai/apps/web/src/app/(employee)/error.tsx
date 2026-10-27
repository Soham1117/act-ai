"use client";

import { usePortalLanguage } from "@/components/portal-language";
import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = usePortalLanguage();
  useEffect(() => {
    console.error("Admin route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">{t("common.errorTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground max-w-md">
          {t("common.errorMessage")}
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">
            digest: {error.digest}
          </p>
        )}
      </div>
      <Button onClick={reset} variant="outline" size="sm">
        <RotateCcw className="mr-2 h-3.5 w-3.5" /> {t("common.tryAgain")}
      </Button>
    </div>
  );
}
