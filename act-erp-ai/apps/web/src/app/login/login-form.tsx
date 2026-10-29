"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { requestLoginChallenge, verifyLoginChallenge } from "@/server/actions/auth";
import { runAction } from "@/lib/toast-action";
import { usePortalLanguage } from "@/components/portal-language";

/** Only same-site paths; never follow an external `next` URL. */
function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")
    ? next
    : "/";
}

type CredsValues = { identifier: string; password: string };
type LoginFailure = { ok: false; error: string; errorCode?: string; errorParams?: Record<string, string | number> };

export function LoginForm({
  next,
  initialError,
}: {
  next?: string;
  initialError?: string;
}) {
  const { t, errorMessage } = usePortalLanguage();
  const credsSchema = useMemo(() => z.object({
    identifier: z.string().min(1, t("auth.login.enterIdentifier")),
    password: z.string().min(1, t("auth.login.required")),
  }), [t]);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showPw, setShowPw] = useState(false);
  const [failure, setFailure] = useState<LoginFailure | null>(() =>
    initialError ? { ok: false, error: "", errorCode: "auth.login.initialError" } : null,
  );
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const error = failure
    ? failure.errorCode === "auth.login.initialError"
      ? t("auth.login.initialError")
      : errorMessage(failure)
    : null;

  const form = useForm<CredsValues>({
    resolver: zodResolver(credsSchema),
    defaultValues: { identifier: "", password: "" },
  });

  function onSubmitCreds(values: CredsValues) {
    setFailure(null);
    startTransition(async () => {
      const res = await runAction(() => requestLoginChallenge(values.identifier, values.password));
      if (!res.ok) {
        setFailure(res);
        return;
      }
      if (!res.challengeId) {
        router.refresh();
        router.push(res.mustChangePassword ? "/change-password" : safeNext(next));
        return;
      }
      setChallengeId(res.challengeId);
    });
  }

  function onSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeId) return;
    setFailure(null);
    startTransition(async () => {
      const res = await runAction(() => verifyLoginChallenge(challengeId, code));
      if (!res.ok) {
        setFailure(res);
        return;
      }
      router.refresh();
      router.push(res.mustChangePassword ? "/change-password" : safeNext(next));
    });
  }

  if (challengeId) {
    return (
      <form onSubmit={onSubmitCode} className="space-y-4">
        {error && (
          <Alert variant="destructive" className="py-2.5">
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col items-center gap-2 text-center">
          <Mail className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm">
          {t("auth.login.twoFactorEmail")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="code">{t("auth.login.code")}</Label>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="text-center font-mono text-xl tracking-[0.4em]"
          />
        </div>
        <Button type="submit" className="w-full" disabled={pending || code.length !== 6}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("auth.login.verify")}
        </Button>
        <button
          type="button"
          onClick={() => {
            setChallengeId(null);
            setCode("");
            setFailure(null);
          }}
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          {t("auth.login.differentAccount")}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmitCreds)} className="space-y-4">
      {error && (
        <Alert variant="destructive" className="py-2.5">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="identifier">{t("auth.login.identifier")}</Label>
        <Input
          id="identifier"
          type="text"
          placeholder="you@actools.com"
          autoComplete="username"
          autoFocus
          {...form.register("identifier")}
        />
        {form.formState.errors.identifier && (
          <p className="text-xs text-destructive">
            {t("auth.login.enterIdentifier")}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">{t("auth.login.password")}</Label>
          <Link
            href="/auth/forgot-password"
            className="text-xs text-muted-foreground hover:text-primary hover:underline"
          >
            {t("auth.login.forgotPassword")}
          </Link>
        </div>
        <div className="relative">
          <Input
            id="password"
            type={showPw ? "text" : "password"}
            autoComplete="current-password"
            {...form.register("password")}
          />
          <button
            type="button"
            onClick={() => setShowPw((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={showPw ? t("auth.login.hidePassword") : t("auth.login.showPassword")}
          >
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {form.formState.errors.password && (
          <p className="text-xs text-destructive">
            {t("auth.login.required")}
          </p>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t("auth.login.submit")}
      </Button>
    </form>
  );
}
