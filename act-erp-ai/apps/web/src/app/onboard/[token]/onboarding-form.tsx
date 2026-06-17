"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, CheckCircle2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitOnboarding, type OnboardingSubmit } from "@/server/actions/onboarding";

type Department = { id: string; name: string };

const STEPS = [
  "Personal",
  "Address",
  "Identity",
  "Employment",
  "Documents",
  "Account",
] as const;

const DOCUMENT_SLOTS: Array<{
  id: string;
  label: string;
  type: "PERSONAL" | "ONBOARDING" | "BENEFITS" | "TRAINING";
}> = [
  { id: "gov_id",         label: "Driver's License / State ID", type: "ONBOARDING" },
  { id: "ssn_card",       label: "Social Security Card",        type: "ONBOARDING" },
  { id: "i9",             label: "I-9",                          type: "ONBOARDING" },
  { id: "w4",             label: "W-4",                          type: "ONBOARDING" },
  { id: "direct_deposit", label: "Direct Deposit Authorization", type: "ONBOARDING" },
  { id: "benefits",       label: "Benefits Enrollment Forms",    type: "BENEFITS" },
  { id: "certifications", label: "Professional Certifications",  type: "TRAINING" },
  { id: "personal",       label: "Personal Documents",           type: "PERSONAL" },
];

type FormState = OnboardingSubmit & { confirmPassword: string };

const initial: FormState = {
  name: "",
  email: "",
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
  ssn: "",
  emergencyName: "",
  emergencyPhone: "",
  employeeId: "",
  departmentId: null,
  jobTitle: "",
  position: "",
  dateOfHire: "",
  employmentType: "FULL_PART_TIME",
  compensationType: "HOURLY_RATE",
  compensationValue: null,
};

const NONE = "__none__";

export function OnboardingForm({
  token,
  suggestedEmail,
  departments,
}: {
  token: string;
  suggestedEmail: string;
  departments: Department[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
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
    if (err) { toast.error(err); return; }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function back() { setStep((s) => Math.max(0, s - 1)); }

  function onPick(id: string, list: FileList | null) {
    const f = list?.[0] ?? null;
    setFiles((prev) => ({ ...prev, [id]: f }));
  }

  function submit() {
    const err = validateStep(STEPS.length - 1, form);
    if (err) { toast.error(err); return; }
    if (form.password !== form.confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }
    startTransition(async () => {
      try {
        const fileEntries = await Promise.all(
          DOCUMENT_SLOTS.flatMap((slot) => {
            const f = files[slot.id];
            if (!f) return [];
            return [readFile(f).then((b64) => ({
              fileName: f.name,
              title: slot.label,
              documentType: slot.type,
              contentType: f.type || "application/octet-stream",
              base64: b64,
            }))];
          }),
        );

        const { confirmPassword, ...payload } = form;
        void confirmPassword;
        await submitOnboarding(token, payload, fileEntries);
        toast.success("Onboarding complete!");
        router.push("/login");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex justify-between text-xs">
          <span className="font-medium">{STEPS[step]}</span>
          <span className="text-muted-foreground">Step {step + 1} of {STEPS.length}</span>
        </div>
        <Progress value={progress} />
      </div>

      {step === 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full name *">
            <Input value={form.name} onChange={(e) => update("name", e.target.value)} required />
          </Field>
          <Field label="Phone">
            <Input value={form.phoneNumber ?? ""} onChange={(e) => update("phoneNumber", e.target.value)} />
          </Field>
          <Field label="Date of birth">
            <Input type="date" value={form.dateOfBirth ?? ""} onChange={(e) => update("dateOfBirth", e.target.value)} />
          </Field>
          <Field label="Gender *">
            <Select value={form.gender} onValueChange={(v) => update("gender", v as FormState["gender"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
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
              onValueChange={(v) => update("maritalStatus", v === NONE ? null : (v as FormState["maritalStatus"]))}
            >
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "SEPARATED", "OTHER"] as const).map((s) => (
                  <SelectItem key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Nationality">
            <Input value={form.nationality ?? ""} onChange={(e) => update("nationality", e.target.value)} />
          </Field>
          <Field label="Education level">
            <Input value={form.educationLevel ?? ""} onChange={(e) => update("educationLevel", e.target.value)} placeholder="High School / Bachelor's / etc." />
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="Street address">
              <Input value={form.address ?? ""} onChange={(e) => update("address", e.target.value)} />
            </Field>
          </div>
          <Field label="City">
            <Input value={form.city ?? ""} onChange={(e) => update("city", e.target.value)} />
          </Field>
          <Field label="State">
            <Input value={form.state ?? ""} onChange={(e) => update("state", e.target.value)} />
          </Field>
          <Field label="Zip code">
            <Input value={form.zipCode ?? ""} onChange={(e) => update("zipCode", e.target.value)} />
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="SSN *">
              <Input
                value={form.ssn}
                onChange={(e) => update("ssn", e.target.value)}
                placeholder="123-45-6789"
                required
              />
            </Field>
          </div>
          <Field label="Emergency contact name">
            <Input value={form.emergencyName ?? ""} onChange={(e) => update("emergencyName", e.target.value)} />
          </Field>
          <Field label="Emergency contact phone">
            <Input value={form.emergencyPhone ?? ""} onChange={(e) => update("emergencyPhone", e.target.value)} />
          </Field>
        </div>
      )}

      {step === 3 && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Employee ID *">
            <Input
              value={form.employeeId}
              onChange={(e) => update("employeeId", e.target.value.toUpperCase())}
              placeholder="ACT001"
              className="font-mono"
              required
            />
          </Field>
          <Field label="Department">
            <Select
              value={form.departmentId ?? NONE}
              onValueChange={(v) => update("departmentId", v === NONE ? null : v)}
            >
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Job title">
            <Input value={form.jobTitle ?? ""} onChange={(e) => update("jobTitle", e.target.value)} />
          </Field>
          <Field label="Position">
            <Input value={form.position ?? ""} onChange={(e) => update("position", e.target.value)} />
          </Field>
          <Field label="Date of hire">
            <Input type="date" value={form.dateOfHire ?? ""} onChange={(e) => update("dateOfHire", e.target.value)} />
          </Field>
          <Field label="Employment type *">
            <Select
              value={form.employmentType}
              onValueChange={(v) => update("employmentType", v as FormState["employmentType"])}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="FULL_PART_TIME">Full-time / Part-time</SelectItem>
                <SelectItem value="CONTRACT_HOURLY">Contract / Hourly</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Compensation type *">
            <Select
              value={form.compensationType}
              onValueChange={(v) => update("compensationType", v as FormState["compensationType"])}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="HOURLY_RATE">Hourly rate</SelectItem>
                <SelectItem value="MONTHLY_SALARY">Monthly salary</SelectItem>
                <SelectItem value="TOTAL_COMPENSATION">Total compensation</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Compensation value">
            <Input
              type="number"
              step="0.01"
              value={form.compensationValue ?? ""}
              onChange={(e) => update("compensationValue", e.target.value === "" ? null : Number(e.target.value))}
            />
          </Field>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Upload any documents now if you have them — you can also upload later.
            Max 10MB per file. PDF, JPG, PNG accepted.
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

      {step === 5 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            This is the email + password you&apos;ll use to sign in. Make sure
            both fields match.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Work email *">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                required
              />
            </Field>
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
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
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
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onClear}>
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
            accept="application/pdf,image/*"
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
      if (!f.ssn || f.ssn.length < 9) return "SSN is required.";
      return null;
    case 3:
      if (!f.employeeId || f.employeeId.length < 2) return "Employee ID is required.";
      return null;
    case 5:
      if (!f.email) return "Email is required.";
      if (!f.password || f.password.length < 8) return "Password must be at least 8 characters.";
      return null;
    default:
      return null;
  }
}
