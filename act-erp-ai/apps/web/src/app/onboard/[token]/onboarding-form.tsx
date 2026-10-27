"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  CheckCircle2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { runAction } from "@/lib/toast-action";
import { submitOnboarding, type OnboardingSubmit } from "@/server/actions/onboarding";
import { usePortalLanguage } from "@/components/portal-language";
import type { ActionFail } from "@/lib/action-result";

const STEPS = [
  "Personal",
  "Address",
  "Identity",
  "Documents",
  "Account",
] as const;

const DOCUMENT_SLOTS: Array<{
  id: string;
  label: string;
  type: "PERSONAL" | "ONBOARDING" | "BENEFITS" | "TRAINING";
}> = [
  { id: "gov_id", label: "Driver's License / State ID", type: "ONBOARDING" },
  { id: "ssn_card", label: "Social Security Card", type: "ONBOARDING" },
  { id: "i9", label: "I-9", type: "ONBOARDING" },
  { id: "w4", label: "W-4", type: "ONBOARDING" },
  { id: "direct_deposit", label: "Direct Deposit Authorization", type: "ONBOARDING" },
  { id: "benefits", label: "Benefits Enrollment Forms", type: "BENEFITS" },
  { id: "certifications", label: "Professional Certifications", type: "TRAINING" },
  { id: "personal", label: "Personal Documents", type: "PERSONAL" },
];

type FormState = OnboardingSubmit & {
  confirmPassword: string;
  email: string;
  username: string;
  personalEmail: string;
};

const initial: FormState = {
  name: "",
  email: "",
  username: "",
  personalEmail: "",
  password: "",
  confirmPassword: "",
  phoneNumber: "",
  dateOfBirth: "",
  gender: "MALE",
  maritalStatus: null,
  address: "",
  city: "",
  state: "",
  zipCode: "",
  nationality: "",
  educationLevel: "",
  ssnLast4: "",
  emergencyName: "",
  emergencyPhone: "",
};

const STEP_KEYS = [
  "auth.onboard.step.personal",
  "auth.onboard.step.address",
  "auth.onboard.step.identity",
  "auth.onboard.step.documents",
  "auth.onboard.step.account",
] as const;

// Documents: same allowlist the server enforces (it re-checks the contents).
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = ["pdf", "png", "jpg", "jpeg"];

const NONE = "__none__";

export function OnboardingForm({
  token,
  suggestedEmail,
  status,
}: {
  token: string;
  suggestedEmail: string;
  status: "open" | "completed" | "expired";
}) {
  const { t, locale, enumLabel, errorMessage, toastAction } = usePortalLanguage();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [submitError, setSubmitError] = useState<ActionFail | null>(null);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>({ ...initial, email: suggestedEmail });
  const [files, setFiles] = useState<Record<string, File | null>>({});

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const isLast = step === STEPS.length - 1;
  const progress = Math.round(((step + 1) / STEPS.length) * 100);

  function next() {
    const err = validateStep(step, form, t);
    if (err) {
      toast.error(err);
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  function onPick(id: string, list: FileList | null) {
    const f = list?.[0] ?? null;
    if (f) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (!ALLOWED_EXT.includes(ext)) {
        toast.error(t("auth.onboard.fileTypeError", { fileName: f.name }));
        return;
      }
      if (f.size > MAX_FILE_BYTES) {
        toast.error(t("auth.onboard.fileSizeError", { fileName: f.name, size: 10 }));
        return;
      }
    }
    setFiles((prev) => ({ ...prev, [id]: f }));
  }

  function submit() {
    const err = validateStep(STEPS.length - 1, form, t);
    if (err) {
      toast.error(err);
      return;
    }
    if (form.password !== form.confirmPassword) {
      toast.error(t("auth.onboard.passwordMismatch"));
      return;
    }
    setSubmitError(null);
    startTransition(async () => {
      const fileEntries = await Promise.all(
        DOCUMENT_SLOTS.flatMap((slot) => {
          const f = files[slot.id];
          if (!f) return [];
          return [
            readFile(f).then((b64) => ({
              fileName: f.name,
              title: slot.label,
              documentType: slot.type,
              contentType: f.type || "application/octet-stream",
              base64: b64,
            })),
          ];
        }),
      );

      const { confirmPassword, ...rest } = form;
      void confirmPassword;
      const res = await runAction(() => submitOnboarding(
        token,
        {
          ...rest,
          email: rest.email.trim().toLowerCase(),
          username: rest.username.trim().toLowerCase(),
          personalEmail: rest.personalEmail.trim().toLowerCase(),
        },
        fileEntries,
      ));
      if (!res.ok) {
        // Keep the (possibly long, per-file) message on screen, not just a toast.
        setSubmitError(res);
        toastAction(res);
        return;
      }
      setDone(true);
    });
  }

  if (done) {
    return (
      <div className="space-y-4 py-4 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t("auth.onboard.completedThanks")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("auth.onboard.sentForApproval")}
          </p>
        </div>
        <Button asChild>
          <Link href="/login">{t("auth.onboard.goSignIn")}</Link>
        </Button>
      </div>
    );
  }

  if (status !== "open") {
    return (
      <div className="space-y-3">
        <Button asChild className="w-full">
          <Link href="/login">{t("auth.onboard.goSignIn")}</Link>
        </Button>
        {status === "expired" && (
          <p className="text-center text-xs text-muted-foreground">
            {t("auth.onboard.expiredSignInHint")}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex justify-between text-xs">
          <span className="font-medium">{t(STEP_KEYS[step]!)}</span>
          <span className="text-muted-foreground">
            {t("auth.onboard.stepCount", { current: step + 1, total: STEPS.length })}
          </span>
        </div>
        <Progress value={progress} />
      </div>

      {step === 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("auth.onboard.fullName")}>
            <Input
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              required
            />
          </Field>
          <Field label={t("auth.onboard.phone")}>
            <Input
              value={form.phoneNumber ?? ""}
              onChange={(e) => update("phoneNumber", e.target.value)}
            />
          </Field>
          <Field label={t("auth.onboard.dateOfBirth")}>
            <Input
              type="date"
              lang={locale}
              value={form.dateOfBirth ?? ""}
              onChange={(e) => update("dateOfBirth", e.target.value)}
            />
          </Field>
          <Field label={t("auth.onboard.gender")}>
            <Select
              value={form.gender}
              onValueChange={(v) => update("gender", v as FormState["gender"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MALE">{enumLabel("MALE")}</SelectItem>
                <SelectItem value="FEMALE">{enumLabel("FEMALE")}</SelectItem>
                <SelectItem value="OTHER">{enumLabel("OTHER")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("auth.onboard.maritalStatus")}>
            <Select
              value={form.maritalStatus ?? NONE}
              onValueChange={(v) =>
                update(
                  "maritalStatus",
                  v === NONE ? null : (v as FormState["maritalStatus"]),
                )
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {(
                  [
                    "SINGLE",
                    "MARRIED",
                    "DIVORCED",
                    "WIDOWED",
                    "SEPARATED",
                    "OTHER",
                  ] as const
                ).map((s) => (
                  <SelectItem key={s} value={s}>
                    {enumLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("auth.onboard.nationality")}>
            <Input
              value={form.nationality ?? ""}
              onChange={(e) => update("nationality", e.target.value)}
            />
          </Field>
          <Field label={t("auth.onboard.educationLevel")}>
            <Input
              value={form.educationLevel ?? ""}
              onChange={(e) => update("educationLevel", e.target.value)}
              placeholder={t("auth.onboard.educationPlaceholder")}
            />
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label={t("auth.onboard.streetAddress")}>
              <Input
                value={form.address ?? ""}
                onChange={(e) => update("address", e.target.value)}
              />
            </Field>
          </div>
          <Field label={t("auth.onboard.city")}>
            <Input
              value={form.city ?? ""}
              onChange={(e) => update("city", e.target.value)}
            />
          </Field>
          <Field label={t("auth.onboard.state")}>
            <Input
              value={form.state ?? ""}
              onChange={(e) => update("state", e.target.value)}
            />
          </Field>
          <Field label={t("auth.onboard.zipCode")}>
            <Input
              value={form.zipCode ?? ""}
              onChange={(e) => update("zipCode", e.target.value)}
            />
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label={t("auth.onboard.ssnLast4")}>
              <Input
                value={form.ssnLast4}
                onChange={(e) =>
                  update("ssnLast4", e.target.value.replace(/\D/g, "").slice(0, 4))
                }
                inputMode="numeric"
                maxLength={4}
                placeholder="6789"
                required
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("auth.onboard.ssnPrivacy")} {" "}
                <Link
                  href="/privacy"
                  target="_blank"
                  className="text-primary hover:underline"
                >
                  {t("auth.onboard.privacyNotice")}
                </Link>{" "}
                {t("auth.onboard.privacyReason")}
              </p>
            </Field>
          </div>
          <Field label={t("auth.onboard.emergencyName")}>
            <Input
              value={form.emergencyName ?? ""}
              onChange={(e) => update("emergencyName", e.target.value)}
            />
          </Field>
          <Field label={t("auth.onboard.emergencyPhone")}>
            <Input
              value={form.emergencyPhone ?? ""}
              onChange={(e) => update("emergencyPhone", e.target.value)}
            />
          </Field>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {t("auth.onboard.uploadHelp")}
          </p>
          {DOCUMENT_SLOTS.map((slot) => (
            <FileSlot
              key={slot.id}
              label={t(`auth.onboard.doc.${slot.id}`)}
              uploadLabel={t("auth.onboard.upload")}
              clearLabel={t("auth.onboard.clearUpload")}
              file={files[slot.id] ?? null}
              formatFileSize={(size) => t("auth.onboard.fileSize", {
                size: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(size / 1024),
              })}
              onPick={(list) => onPick(slot.id, list)}
              onClear={() => setFiles((p) => ({ ...p, [slot.id]: null }))}
            />
          ))}
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          {submitError && (
            <Alert variant="destructive" className="py-2.5">
            <AlertDescription className="text-xs">{errorMessage(submitError)}</AlertDescription>
            </Alert>
          )}
          <p className="text-xs text-muted-foreground">
            {t("auth.onboard.createAccountHelp")}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("auth.onboard.workEmail")}>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
              />
            </Field>
            <Field label={t("auth.onboard.username")}>
              <Input
                value={form.username ?? ""}
                onChange={(e) =>
                  update("username", e.target.value.toLowerCase().replace(/\s/g, ""))
                }
                placeholder={t("auth.onboard.usernamePlaceholder")}
              />
            </Field>
            <div className="col-span-2">
              <Field label={t("auth.onboard.personalEmail")}>
                <Input
                  type="email"
                  value={form.personalEmail ?? ""}
                  onChange={(e) => update("personalEmail", e.target.value)}
                />
              </Field>
            </div>
            <Field label={t("auth.onboard.password")}>
              <Input
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
                minLength={8}
                required
              />
            </Field>
            <Field label={t("auth.onboard.confirmPassword")}>
              <Input
                type="password"
                autoComplete="new-password"
                value={form.confirmPassword}
                onChange={(e) => update("confirmPassword", e.target.value)}
                minLength={8}
                required
              />
            </Field>
          </div>
        </div>
      )}

      <div className="flex justify-between gap-2 pt-2">
        <Button variant="outline" onClick={back} disabled={step === 0 || pending}>
          <ChevronLeft className="mr-1 h-4 w-4" /> {t("auth.onboard.back")}
        </Button>
        {isLast ? (
          <Button onClick={submit} disabled={pending}>
            {pending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            {t("auth.onboard.submit")}
          </Button>
        ) : (
          <Button onClick={next} disabled={pending}>
            {t("auth.onboard.next")} <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function FileSlot({
  label,
  uploadLabel,
  clearLabel,
  file,
  formatFileSize,
  onPick,
  onClear,
}: {
  label: string;
  uploadLabel: string;
  clearLabel: string;
  file: File | null;
  formatFileSize: (size: number) => string;
  onPick: (list: FileList | null) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{label}</p>
        {file && (
          <p className="truncate text-[11px] text-muted-foreground">
            {file.name} · {formatFileSize(file.size)}
          </p>
        )}
      </div>
      {file ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={clearLabel}
          title={clearLabel}
          onClick={onClear}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <label className="cursor-pointer">
          <span className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1 text-xs hover:bg-muted">
            <Upload className="h-3 w-3" />
            {uploadLabel}
          </span>
          <input
            type="file"
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            onChange={(e) => onPick(e.target.files)}
          />
        </label>
      )}
    </div>
  );
}

function readFile(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is a data URL — strip the prefix to get raw base64
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(f);
  });
}

function validateStep(
  step: number,
  f: FormState,
  t: (key: string) => string,
): string | null {
  switch (step) {
    case 0:
      if (!f.name || f.name.length < 2) return t("auth.onboard.validation.fullName");
      return null;
    case 2:
      if (!/^\d{4}$/.test(f.ssnLast4 ?? ""))
        return t("auth.onboard.validation.ssn");
      return null;
    case 4:
      if (!f.email.trim() && !f.username.trim())
        return t("auth.onboard.validation.emailOrUsername");
      if (f.username.trim() && !/^[a-z0-9._-]{3,32}$/.test(f.username.trim().toLowerCase()))
        return t("auth.onboard.validation.username");
      if (!f.password || f.password.length < 8)
        return t("auth.onboard.validation.password");
      return null;
    default:
      return null;
  }
}
