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
import { toastAction } from "@/lib/toast-action";
import { submitOnboarding, type OnboardingSubmit } from "@/server/actions/onboarding";

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

// Documents: same allowlist the server enforces (it re-checks the contents).
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = ["pdf", "png", "jpg", "jpeg"];

const NONE = "__none__";

export function OnboardingForm({
  token,
  suggestedEmail,
}: {
  token: string;
  suggestedEmail: string;
}) {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>({ ...initial, email: suggestedEmail });
  const [files, setFiles] = useState<Record<string, File | null>>({});

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const isLast = step === STEPS.length - 1;
  const progress = Math.round(((step + 1) / STEPS.length) * 100);

  function next() {
    const err = validateStep(step, form);
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
        toast.error(`${f.name}: only PDF, PNG or JPG files are accepted.`);
        return;
      }
      if (f.size > MAX_FILE_BYTES) {
        toast.error(`${f.name} is larger than 10 MB. Compress it and try again.`);
        return;
      }
    }
    setFiles((prev) => ({ ...prev, [id]: f }));
  }

  function submit() {
    const err = validateStep(STEPS.length - 1, form);
    if (err) {
      toast.error(err);
      return;
    }
    if (form.password !== form.confirmPassword) {
      toast.error("Passwords don't match");
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
      const res = await submitOnboarding(
        token,
        {
          ...rest,
          email: rest.email.trim().toLowerCase(),
          username: rest.username.trim().toLowerCase(),
          personalEmail: rest.personalEmail.trim().toLowerCase(),
        },
        fileEntries,
      );
      if (!res.ok) {
        // Keep the (possibly long, per-file) message on screen, not just a toast.
        setSubmitError(res.error);
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
          <h2 className="text-lg font-semibold">Thanks, you&apos;re all set</h2>
          <p className="text-sm text-muted-foreground">
            Your account has been created and sent to an administrator for approval. You can
            sign in now to look around; you&apos;ll be able to make changes (time off, requests,
            reimbursements) once you&apos;re approved.
          </p>
        </div>
        <Button asChild>
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex justify-between text-xs">
          <span className="font-medium">{STEPS[step]}</span>
          <span className="text-muted-foreground">
            Step {step + 1} of {STEPS.length}
          </span>
        </div>
        <Progress value={progress} />
      </div>

      {step === 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full name *">
            <Input
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              required
            />
          </Field>
          <Field label="Phone">
            <Input
              value={form.phoneNumber ?? ""}
              onChange={(e) => update("phoneNumber", e.target.value)}
            />
          </Field>
          <Field label="Date of birth">
            <Input
              type="date"
              value={form.dateOfBirth ?? ""}
              onChange={(e) => update("dateOfBirth", e.target.value)}
            />
          </Field>
          <Field label="Gender *">
            <Select
              value={form.gender}
              onValueChange={(v) => update("gender", v as FormState["gender"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MALE">Male</SelectItem>
                <SelectItem value="FEMALE">Female</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Marital status">
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
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Nationality">
            <Input
              value={form.nationality ?? ""}
              onChange={(e) => update("nationality", e.target.value)}
            />
          </Field>
          <Field label="Education level">
            <Input
              value={form.educationLevel ?? ""}
              onChange={(e) => update("educationLevel", e.target.value)}
              placeholder="High School / Bachelor's / etc."
            />
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="Street address">
              <Input
                value={form.address ?? ""}
                onChange={(e) => update("address", e.target.value)}
              />
            </Field>
          </div>
          <Field label="City">
            <Input
              value={form.city ?? ""}
              onChange={(e) => update("city", e.target.value)}
            />
          </Field>
          <Field label="State">
            <Input
              value={form.state ?? ""}
              onChange={(e) => update("state", e.target.value)}
            />
          </Field>
          <Field label="Zip code">
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
            <Field label="SSN — last 4 digits *">
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
                We only collect the last 4 digits — never your full Social Security
                Number. See our{" "}
                <Link
                  href="/privacy"
                  target="_blank"
                  className="text-primary hover:underline"
                >
                  privacy notice
                </Link>{" "}
                for what we collect and why.
              </p>
            </Field>
          </div>
          <Field label="Emergency contact name">
            <Input
              value={form.emergencyName ?? ""}
              onChange={(e) => update("emergencyName", e.target.value)}
            />
          </Field>
          <Field label="Emergency contact phone">
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
            Upload any documents now if you have them — you can also upload later. Max
            10 MB per file. PDF, JPG and PNG only.
          </p>
          {DOCUMENT_SLOTS.map((slot) => (
            <FileSlot
              key={slot.id}
              label={slot.label}
              file={files[slot.id] ?? null}
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
              <AlertDescription className="text-xs">{submitError}</AlertDescription>
            </Alert>
          )}
          <p className="text-xs text-muted-foreground">
            Create a username and password for sign-in. Email addresses are optional while
            email verification is paused. Emails and usernames are not case-sensitive.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Work email (leave blank if you don't have one)">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
              />
            </Field>
            <Field label="Username (only if no work email above) *">
              <Input
                value={form.username ?? ""}
                onChange={(e) =>
                  update("username", e.target.value.toLowerCase().replace(/\s/g, ""))
                }
                placeholder="jsmith"
              />
            </Field>
            <div className="col-span-2">
              <Field label="Personal email (optional)">
                <Input
                  type="email"
                  value={form.personalEmail ?? ""}
                  onChange={(e) => update("personalEmail", e.target.value)}
                />
              </Field>
            </div>
            <Field label="Password *">
              <Input
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
                minLength={8}
                required
              />
            </Field>
            <Field label="Confirm password *">
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
          <ChevronLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        {isLast ? (
          <Button onClick={submit} disabled={pending}>
            {pending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            Submit
          </Button>
        ) : (
          <Button onClick={next} disabled={pending}>
            Next <ChevronRight className="ml-1 h-4 w-4" />
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
  file,
  onPick,
  onClear,
}: {
  label: string;
  file: File | null;
  onPick: (list: FileList | null) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{label}</p>
        {file && (
          <p className="truncate text-[11px] text-muted-foreground">
            {file.name} · {(file.size / 1024).toFixed(0)} KB
          </p>
        )}
      </div>
      {file ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClear}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <label className="cursor-pointer">
          <span className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1 text-xs hover:bg-muted">
            <Upload className="h-3 w-3" />
            Upload
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

function validateStep(step: number, f: FormState): string | null {
  switch (step) {
    case 0:
      if (!f.name || f.name.length < 2) return "Please enter your full name.";
      return null;
    case 2:
      if (!/^\d{4}$/.test(f.ssnLast4 ?? ""))
        return "Enter the last 4 digits of your SSN.";
      return null;
    case 4:
      if (!f.email.trim() && !f.username.trim())
        return "Enter either a work email or a username.";
      if (f.username.trim() && !/^[a-z0-9._-]{3,32}$/.test(f.username.trim().toLowerCase()))
        return "Username: letters, numbers, . _ - only, 3-32 characters.";
      if (!f.password || f.password.length < 8)
        return "Password must be at least 8 characters.";
      return null;
    default:
      return null;
  }
}
