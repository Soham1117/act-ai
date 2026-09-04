"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { requestLoginChallenge, verifyLoginChallenge } from "@/server/actions/auth";

const credsSchema = z.object({
  identifier: z.string().min(1, "Enter your email or username"),
  password: z.string().min(1, "Required"),
});
type CredsValues = z.infer<typeof credsSchema>;

export function LoginForm({
  next,
  initialError,
}: {
  next?: string;
  initialError?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const form = useForm<CredsValues>({
    resolver: zodResolver(credsSchema),
    defaultValues: { identifier: "", password: "" },
  });

  function onSubmitCreds(values: CredsValues) {
    setError(null);
    startTransition(async () => {
      const res = await requestLoginChallenge(values.identifier, values.password);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (!res.challengeId) {
        router.refresh();
        router.push(next || "/");
        return;
      }
      setChallengeId(res.challengeId);
    });
  }

  function onSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeId) return;
    setError(null);
    startTransition(async () => {
      const res = await verifyLoginChallenge(challengeId, code);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      router.push(next || "/");
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
            We emailed a 6-digit code to your personal email. It expires in 10 minutes.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="code">Code</Label>
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
          Verify and sign in
        </Button>
        <button
          type="button"
          onClick={() => {
            setChallengeId(null);
            setCode("");
            setError(null);
          }}
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Use a different account
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
        <Label htmlFor="identifier">Email or username</Label>
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
            {form.formState.errors.identifier.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/auth/forgot-password"
            className="text-xs text-muted-foreground hover:text-primary hover:underline"
          >
            Forgot password?
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
            aria-label={showPw ? "Hide password" : "Show password"}
          >
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {form.formState.errors.password && (
          <p className="text-xs text-destructive">
            {form.formState.errors.password.message}
          </p>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Sign in
      </Button>
    </form>
  );
}
