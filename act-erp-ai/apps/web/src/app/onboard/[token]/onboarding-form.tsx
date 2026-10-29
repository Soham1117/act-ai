"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { runAction } from "@/lib/toast-action";
import {
  saveOnboardingDraft,
  submitOnboarding,
  type OnboardingSubmit,
} from "@/server/actions/onboarding";
import { usePortalLanguage } from "@/components/portal-language";
import type { ActionFail } from "@/lib/action-result";
import {
  BACKGROUND_CHECK_CONSENT_TEXT,
  DIRECT_DEPOSIT_ACK_TEXT,
  DRUG_ALCOHOL_CONSENT_TEXT,
  ONBOARDING_CONSENT_VERSION,
  emptyApplication,
  type HandbookTemplateOption,
  type OnboardingApplication,
  type OnboardingPacketPayload,
} from "@/lib/onboarding-packet";
import {
  EDUCATION_DEGREES,
  EDUCATION_LEVELS,
  NATIONALITIES,
  US_STATES,
} from "@/lib/onboarding-options";
import {
  draftStorageKey,
  mergeDraftApplication,
  readBrowserDraft,
  sanitizeBrowserDraftFields,
  sanitizeDraftFields,
  type OnboardingDraft,
} from "@/lib/onboarding-draft";

const STEPS = [
  "Personal",
  "Address",
  "Application",
  "Consents",
  "Direct deposit",
  "Handbook",
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
  { id: "benefits", label: "Benefits Enrollment Forms", type: "BENEFITS" },
  { id: "certifications", label: "Professional Certifications", type: "TRAINING" },
  { id: "personal", label: "Personal Documents", type: "PERSONAL" },
];

type FormState = Omit<OnboardingSubmit, "packet"> & {
  confirmPassword: string;
  email: string;
  username: string;
  personalEmail: string;
  application: OnboardingApplication;
  drugPrintedName: string;
  drugAccepted: boolean;
  backgroundPrintedName: string;
  backgroundAccepted: boolean;
  ddBankName: string;
  ddBankLocation: string;
  ddRouting: string;
  ddAccount: string;
  ddAccountType: "CHECKING" | "SAVINGS";
  ddPrintedName: string;
  ddAccepted: boolean;
  handbookPrintedName: string;
  handbookAccepted: boolean;
  handbookChecklistItemId: string;
};

const initialApplication = emptyApplication();

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
  application: initialApplication,
  drugPrintedName: "",
  drugAccepted: false,
  backgroundPrintedName: "",
  backgroundAccepted: false,
  ddBankName: "",
  ddBankLocation: "",
  ddRouting: "",
  ddAccount: "",
  ddAccountType: "CHECKING",
  ddPrintedName: "",
  ddAccepted: false,
  handbookPrintedName: "",
  handbookAccepted: false,
  handbookChecklistItemId: "",
};

const STEP_KEYS = [
  "auth.onboard.step.personal",
  "auth.onboard.step.address",
  "auth.onboard.step.application",
  "auth.onboard.step.consents",
  "auth.onboard.step.directDeposit",
  "auth.onboard.step.handbook",
  "auth.onboard.step.documents",
  "auth.onboard.step.account",
] as const;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = ["pdf", "png", "jpg", "jpeg"];
const NONE = "__none__";

function buildInitialForm(
  suggestedEmail: string,
  suggestedJobTitle: string,
  handbookTemplates: HandbookTemplateOption[],
  draft: OnboardingDraft | null,
): { form: FormState; step: number; nationalityOther: string; educationOther: string } {
  const fields = draft?.fields ?? {};
  const application = mergeDraftApplication(fields.application, suggestedJobTitle);
  return {
    step: Math.min(Math.max(draft?.step ?? 0, 0), STEPS.length - 1),
    nationalityOther: fields.nationalityOther ?? "",
    educationOther: fields.educationOther ?? "",
    form: {
      ...initial,
      name: fields.name ?? "",
      email: fields.email ?? suggestedEmail,
      username: fields.username ?? "",
      personalEmail: fields.personalEmail ?? "",
      phoneNumber: fields.phoneNumber ?? "",
      dateOfBirth: fields.dateOfBirth ?? "",
      gender: fields.gender ?? "MALE",
      maritalStatus: fields.maritalStatus ?? null,
      address: fields.address ?? "",
      city: fields.city ?? "",
      state: fields.state ?? "",
      zipCode: fields.zipCode ?? "",
      nationality: fields.nationality ?? "",
      educationLevel: fields.educationLevel ?? "",
      ssnLast4: fields.ssnLast4 ?? "",
      emergencyName: fields.emergencyName ?? "",
      emergencyPhone: fields.emergencyPhone ?? "",
      application,
      drugPrintedName: fields.drugPrintedName ?? "",
      drugAccepted: fields.drugAccepted ?? false,
      backgroundPrintedName: fields.backgroundPrintedName ?? "",
      backgroundAccepted: fields.backgroundAccepted ?? false,
      ddBankName: fields.ddBankName ?? "",
      ddBankLocation: fields.ddBankLocation ?? "",
      ddRouting: "",
      ddAccount: "",
      ddAccountType: fields.ddAccountType ?? "CHECKING",
      ddPrintedName: fields.ddPrintedName ?? "",
      ddAccepted: false,
      handbookPrintedName: fields.handbookPrintedName ?? "",
      handbookAccepted: fields.handbookAccepted ?? false,
      handbookChecklistItemId:
        fields.handbookChecklistItemId ||
        handbookTemplates[0]?.checklistItemId ||
        "",
    },
  };
}

function readLocalDraft(token: string): OnboardingDraft | null {
  if (typeof window === "undefined") return null;
  try {
    return readBrowserDraft(window.localStorage, token);
  } catch {
    return null;
  }
}

function pickNewerDraft(
  server: OnboardingDraft | null,
  local: OnboardingDraft | null,
): OnboardingDraft | null {
  if (!server) return local;
  if (!local) return server;
  const s = server.savedAt ? Date.parse(server.savedAt) : 0;
  const l = local.savedAt ? Date.parse(local.savedAt) : 0;
  // A newer local step contains progress only, so retain the server's answers.
  return l > s
    ? { ...local, fields: { ...server.fields, ...local.fields } }
    : server;
}

export function OnboardingForm({
  token,
  suggestedEmail,
  suggestedJobTitle = "",
  status,
  handbookTemplates = [],
  initialDraft = null,
}: {
  token: string;
  suggestedEmail: string;
  suggestedJobTitle?: string;
  status: "open" | "completed" | "expired";
  handbookTemplates?: HandbookTemplateOption[];
  initialDraft?: OnboardingDraft | null;
}) {
  const { t, locale, enumLabel, errorMessage, toastAction } = usePortalLanguage();
  const [boot] = useState(() =>
    buildInitialForm(suggestedEmail, suggestedJobTitle, handbookTemplates, initialDraft),
  );
  const [step, setStep] = useState(boot.step);
  const [done, setDone] = useState(false);
  const [submitError, setSubmitError] = useState<ActionFail | null>(null);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(boot.form);
  const [nationalityOther, setNationalityOther] = useState(boot.nationalityOther);
  const [educationOther, setEducationOther] = useState(boot.educationOther);
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(
    initialDraft?.savedAt ?? null,
  );
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSaveFailed, setDraftSaveFailed] = useState(false);
  const draftSaveSequence = useRef(0);
  const [showDraftBanner, setShowDraftBanner] = useState(false);
  const hydratedLocal = useRef(false);
  const skipNextAutosave = useRef(Boolean(initialDraft));
  const formRef = useRef(form);
  const stepRef = useRef(step);
  const nationalityOtherRef = useRef(nationalityOther);
  const educationOtherRef = useRef(educationOther);
  useEffect(() => {
    formRef.current = form;
    stepRef.current = step;
    nationalityOtherRef.current = nationalityOther;
    educationOtherRef.current = educationOther;
  }, [form, step, nationalityOther, educationOther]);

  /* eslint-disable react-hooks/set-state-in-effect -- Hydrate browser-only storage after mount; SSR cannot read localStorage. */
  useEffect(() => {
    if (status !== "open" || done) {
      try {
        window.localStorage.removeItem(draftStorageKey(token));
      } catch {
        /* private mode / storage unavailable */
      }
      return;
    }
    if (hydratedLocal.current) return;
    hydratedLocal.current = true;
    const local = readLocalDraft(token);
    const chosen = pickNewerDraft(initialDraft, local);
    if (!chosen) return;
    const hasProgress =
      (chosen.step ?? 0) > 0 || Boolean(chosen.fields?.name?.trim());
    if (chosen !== initialDraft) {
      const nextState = buildInitialForm(
        suggestedEmail,
        suggestedJobTitle,
        handbookTemplates,
        chosen,
      );
      skipNextAutosave.current = true;
      setForm(nextState.form);
      setStep(nextState.step);
      setNationalityOther(nextState.nationalityOther);
      setEducationOther(nextState.educationOther);
      setDraftSavedAt(chosen.savedAt ?? null);
    }
    if (hasProgress) setShowDraftBanner(true);
  }, [
    status,
    done,
    token,
    initialDraft,
    suggestedEmail,
    suggestedJobTitle,
    handbookTemplates,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function persistDraft(nextStep = stepRef.current) {
    if (status !== "open" || done) return;
    const payload: OnboardingDraft = {
      step: nextStep,
      fields: sanitizeDraftFields({
        ...formRef.current,
        nationalityOther: nationalityOtherRef.current,
        educationOther: educationOtherRef.current,
      }),
      savedAt: new Date().toISOString(),
    };
    try {
      window.localStorage.setItem(
        draftStorageKey(token),
        JSON.stringify({
          ...payload,
          fields: sanitizeBrowserDraftFields(payload.fields),
        }),
      );
    } catch {
      /* quota / private mode */
    }
    const sequence = ++draftSaveSequence.current;
    setDraftSaving(true);
    setDraftSaveFailed(false);
    void saveOnboardingDraft(token, {
      step: payload.step,
      fields: payload.fields as Record<string, unknown>,
    }).then((res) => {
      if (sequence !== draftSaveSequence.current) return;
      setDraftSaving(false);
      if (res.ok) setDraftSavedAt(res.savedAt);
      else setDraftSaveFailed(true);
    }).catch(() => {
      if (sequence !== draftSaveSequence.current) return;
      setDraftSaving(false);
      setDraftSaveFailed(true);
    });
  }

  useEffect(() => {
    if (status !== "open" || done) return;
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    const timer = window.setTimeout(() => persistDraft(step), 1500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional field watch
  }, [form, step, nationalityOther, educationOther, status, token, done]);

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function updateApp<K extends keyof OnboardingApplication>(k: K, v: OnboardingApplication[K]) {
    setForm((f) => ({ ...f, application: { ...f.application, [k]: v } }));
  }

  const isLast = step === STEPS.length - 1;
  const progress = Math.round(((step + 1) / STEPS.length) * 100);
  const selectedHandbook =
    handbookTemplates.find((h) => h.checklistItemId === form.handbookChecklistItemId) ??
    handbookTemplates[0] ??
    null;

  function next() {
    const err = validateStep(step, form, t, handbookTemplates.length > 0);
    if (err) {
      toast.error(err);
      return;
    }
    const nextStep = Math.min(step + 1, STEPS.length - 1);
    setStep(nextStep);
    persistDraft(nextStep);
  }
  function back() {
    const nextStep = Math.max(step - 1, 0);
    setStep(nextStep);
    persistDraft(nextStep);
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

  function buildPacket(): OnboardingPacketPayload {
    const printed = form.name.trim() || form.drugPrintedName.trim();
    return {
      application: form.application,
      drugAlcohol: {
        accepted: true as const,
        printedName: form.drugPrintedName.trim() || printed,
        textVersion: ONBOARDING_CONSENT_VERSION,
      },
      background: {
        accepted: true as const,
        printedName: form.backgroundPrintedName.trim() || printed,
        textVersion: ONBOARDING_CONSENT_VERSION,
      },
      directDeposit: {
        bankName: form.ddBankName.trim(),
        bankLocation: form.ddBankLocation.trim() || null,
        routingNumber: form.ddRouting.trim(),
        accountNumber: form.ddAccount.trim(),
        accountType: form.ddAccountType,
        printedName: form.ddPrintedName.trim() || printed,
        accepted: true as const,
        textVersion: ONBOARDING_CONSENT_VERSION,
      },
      handbook: {
        accepted: true as const,
        printedName: form.handbookPrintedName.trim() || printed,
        checklistItemId: selectedHandbook?.checklistItemId ?? null,
        versionId: selectedHandbook?.versionId ?? null,
        title: selectedHandbook?.title ?? "Employee Handbook",
        versionNumber: selectedHandbook?.version ?? 1,
      },
    };
  }

  function submit() {
    const err = validateStep(STEPS.length - 1, form, t, handbookTemplates.length > 0);
    if (err) {
      toast.error(err);
      return;
    }
    if (form.password !== form.confirmPassword) {
      toast.error(t("auth.onboard.passwordMismatch"));
      return;
    }
    for (let s = 0; s < STEPS.length - 1; s++) {
      const stepErr = validateStep(s, form, t, handbookTemplates.length > 0);
      if (stepErr) {
        toast.error(stepErr);
        setStep(s);
        return;
      }
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

      const {
        confirmPassword,
        application,
        drugPrintedName,
        drugAccepted,
        backgroundPrintedName,
        backgroundAccepted,
        ddBankName,
        ddBankLocation,
        ddRouting,
        ddAccount,
        ddAccountType,
        ddPrintedName,
        ddAccepted,
        handbookPrintedName,
        handbookAccepted,
        handbookChecklistItemId,
        ...rest
      } = form;
      void confirmPassword;
      void application;
      void drugPrintedName;
      void drugAccepted;
      void backgroundPrintedName;
      void backgroundAccepted;
      void ddBankName;
      void ddBankLocation;
      void ddRouting;
      void ddAccount;
      void ddAccountType;
      void ddPrintedName;
      void ddAccepted;
      void handbookPrintedName;
      void handbookAccepted;
      void handbookChecklistItemId;

      const res = await runAction(() =>
        submitOnboarding(
          token,
          {
            ...rest,
            email: rest.email.trim().toLowerCase(),
            username: rest.username.trim().toLowerCase(),
            personalEmail: rest.personalEmail.trim().toLowerCase(),
            packet: buildPacket(),
          },
          fileEntries,
        ),
      );
      if (!res.ok) {
        setSubmitError(res);
        toastAction(res);
        return;
      }
      try {
        window.localStorage.removeItem(draftStorageKey(token));
      } catch {
        /* ignore */
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
        <p className="mt-1 text-[11px] text-muted-foreground">
          {draftSaving
            ? t("auth.onboard.draftSaving")
            : draftSaveFailed
              ? t("auth.onboard.draftSaveFailed")
              : draftSavedAt
              ? t("auth.onboard.draftSaved")
              : t("auth.onboard.draftHint")}
          {draftSaveFailed && !draftSaving && (
            <button type="button" className="ml-2 underline" onClick={() => persistDraft()}>
              {t("auth.onboard.draftRetry")}
            </button>
          )}
        </p>
      </div>

      {showDraftBanner && (
        <div
          role="status"
          className="flex items-start justify-between gap-3 rounded-md border border-emerald-700/40 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-950"
        >
          <p className="font-medium leading-snug">{t("auth.onboard.draftRestored")}</p>
          <button
            type="button"
            className="shrink-0 text-xs font-semibold text-emerald-900 underline-offset-2 hover:underline"
            onClick={() => setShowDraftBanner(false)}
          >
            {t("auth.onboard.draftDismiss")}
          </button>
        </div>
      )}

      {step === 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("auth.onboard.fullName")}>
            <Input value={form.name} onChange={(e) => update("name", e.target.value)} required />
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
                update("maritalStatus", v === NONE ? null : (v as FormState["maritalStatus"]))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {(
                  ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "SEPARATED", "OTHER"] as const
                ).map((s) => (
                  <SelectItem key={s} value={s}>
                    {enumLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("auth.onboard.nationality")}>
            <OptionSelect
              value={
                form.nationality && NATIONALITIES.includes(form.nationality)
                  ? form.nationality
                  : form.nationality
                    ? "Other"
                    : NONE
              }
              onChange={(v) => {
                if (v === NONE) {
                  update("nationality", "");
                  setNationalityOther("");
                  return;
                }
                if (v === "Other") {
                  update("nationality", nationalityOther || "Other");
                  return;
                }
                update("nationality", v);
                setNationalityOther("");
              }}
              options={NATIONALITIES.map((n) => ({ value: n, label: n }))}
              allowEmpty
            />
          </Field>
          {(form.nationality === "Other" ||
            (form.nationality && !NATIONALITIES.includes(form.nationality))) && (
            <Field label={t("auth.onboard.nationalityOther")}>
              <Input
                value={nationalityOther || (form.nationality === "Other" ? "" : form.nationality ?? "")}
                onChange={(e) => {
                  setNationalityOther(e.target.value);
                  update("nationality", e.target.value || "Other");
                }}
              />
            </Field>
          )}
          <Field label={t("auth.onboard.educationLevel")}>
            <OptionSelect
              value={
                form.educationLevel && EDUCATION_LEVELS.includes(form.educationLevel)
                  ? form.educationLevel
                  : form.educationLevel
                    ? "Other"
                    : NONE
              }
              onChange={(v) => {
                if (v === NONE) {
                  update("educationLevel", "");
                  setEducationOther("");
                  return;
                }
                if (v === "Other") {
                  update("educationLevel", educationOther || "Other");
                  return;
                }
                update("educationLevel", v);
                setEducationOther("");
              }}
              options={EDUCATION_LEVELS.map((n) => ({ value: n, label: n }))}
              allowEmpty
            />
          </Field>
          {(form.educationLevel === "Other" ||
            (form.educationLevel && !EDUCATION_LEVELS.includes(form.educationLevel))) && (
            <Field label={t("auth.onboard.educationOther")}>
              <Input
                value={
                  educationOther || (form.educationLevel === "Other" ? "" : form.educationLevel ?? "")
                }
                onChange={(e) => {
                  setEducationOther(e.target.value);
                  update("educationLevel", e.target.value || "Other");
                }}
              />
            </Field>
          )}
          <Field label={t("auth.onboard.ssnLast4")}>
            <Input
              value={form.ssnLast4}
              onChange={(e) => update("ssnLast4", e.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              maxLength={4}
              placeholder="6789"
              required
            />
          </Field>
          <Field label={t("auth.onboard.dlNumber")}>
            <Input
              value={form.application.driversLicenseNumber ?? ""}
              onChange={(e) => updateApp("driversLicenseNumber", e.target.value)}
            />
          </Field>
          <Field label={t("auth.onboard.dlState")}>
            <StateSelect
              value={form.application.driversLicenseState ?? ""}
              onChange={(v) => updateApp("driversLicenseState", v)}
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
            <Input value={form.city ?? ""} onChange={(e) => update("city", e.target.value)} />
          </Field>
          <Field label={t("auth.onboard.state")}>
            <StateSelect value={form.state ?? ""} onChange={(v) => update("state", v)} />
          </Field>
          <Field label={t("auth.onboard.zipCode")}>
            <Input
              value={form.zipCode ?? ""}
              onChange={(e) => update("zipCode", e.target.value)}
            />
          </Field>
          <div className="col-span-2 border-t pt-3">
            <p className="mb-2 text-xs font-medium">{t("auth.onboard.previousAddress")}</p>
          </div>
          <div className="col-span-2">
            <Field label={t("auth.onboard.previousStreet")}>
              <Input
                value={form.application.previousAddress ?? ""}
                onChange={(e) => updateApp("previousAddress", e.target.value)}
              />
            </Field>
          </div>
          <Field label={t("auth.onboard.city")}>
            <Input
              value={form.application.previousCity ?? ""}
              onChange={(e) => updateApp("previousCity", e.target.value)}
            />
          </Field>
          <Field label={t("auth.onboard.state")}>
            <StateSelect
              value={form.application.previousState ?? ""}
              onChange={(v) => updateApp("previousState", v)}
            />
          </Field>
          <Field label={t("auth.onboard.zipCode")}>
            <Input
              value={form.application.previousZip ?? ""}
              onChange={(e) => updateApp("previousZip", e.target.value)}
            />
          </Field>
          <Field label={t("auth.onboard.previousDates")}>
            <Input
              value={form.application.previousAddressDates ?? ""}
              onChange={(e) => updateApp("previousAddressDates", e.target.value)}
              placeholder="2019–2022"
            />
          </Field>
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

      {step === 2 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("auth.onboard.positionApplied")}>
              <Input
                value={form.application.positionApplied ?? ""}
                onChange={(e) => updateApp("positionApplied", e.target.value)}
              />
            </Field>
            <Field label={t("auth.onboard.dateCanBegin")}>
              <Input
                type="date"
                lang={locale}
                value={form.application.dateCanBegin ?? ""}
                onChange={(e) => updateApp("dateCanBegin", e.target.value)}
              />
            </Field>
            <Field label={t("auth.onboard.minSalary")}>
              <Input
                value={form.application.minSalary ?? ""}
                onChange={(e) => updateApp("minSalary", e.target.value)}
              />
            </Field>
            <YesNo
              label={t("auth.onboard.overtimeOk")}
              value={form.application.overtimeOk}
              onChange={(v) => updateApp("overtimeOk", v)}
            />
            <YesNo
              label={t("auth.onboard.workInUsa")}
              value={form.application.workInUsa}
              onChange={(v) => updateApp("workInUsa", v)}
            />
            <YesNo
              label={t("auth.onboard.previouslyAtAct")}
              value={form.application.previouslyWorkedAtAct}
              onChange={(v) => updateApp("previouslyWorkedAtAct", v)}
            />
            <YesNo
              label={t("auth.onboard.relativesAtAct")}
              value={form.application.relativesAtAct}
              onChange={(v) => updateApp("relativesAtAct", v)}
            />
            <Field label={t("auth.onboard.relativesExplain")}>
              <Input
                value={form.application.relativesExplain ?? ""}
                onChange={(e) => updateApp("relativesExplain", e.target.value)}
              />
            </Field>
          </div>

          <SectionTitle>{t("auth.onboard.educationSection")}</SectionTitle>
          {(["highSchool", "vocational", "college", "gradSchool"] as const).map((key) => {
            const row = form.application[key] ?? {
              name: null,
              location: null,
              studies: null,
              degree: null,
            };
            const labels: Record<typeof key, string> = {
              highSchool: t("auth.onboard.edu.highSchool"),
              vocational: t("auth.onboard.edu.vocational"),
              college: t("auth.onboard.edu.college"),
              gradSchool: t("auth.onboard.edu.gradSchool"),
            };
            return (
              <div key={key} className="grid grid-cols-2 gap-2 rounded-md border p-3">
                <p className="col-span-2 text-xs font-medium">{labels[key]}</p>
                <Input
                  placeholder={t("auth.onboard.edu.name")}
                  value={row.name ?? ""}
                  onChange={(e) =>
                    updateApp(key, { ...row, name: e.target.value || null })
                  }
                />
                <Input
                  placeholder={t("auth.onboard.edu.location")}
                  value={row.location ?? ""}
                  onChange={(e) =>
                    updateApp(key, { ...row, location: e.target.value || null })
                  }
                />
                <Input
                  placeholder={t("auth.onboard.edu.studies")}
                  value={row.studies ?? ""}
                  onChange={(e) =>
                    updateApp(key, { ...row, studies: e.target.value || null })
                  }
                />
                <OptionSelect
                  value={row.degree ?? NONE}
                  onChange={(v) =>
                    updateApp(key, { ...row, degree: v === NONE ? null : v })
                  }
                  options={EDUCATION_DEGREES.map((d) => ({ value: d, label: d }))}
                  allowEmpty
                  placeholder={t("auth.onboard.edu.degree")}
                />
              </div>
            );
          })}

          <SectionTitle>{t("auth.onboard.employmentSection")}</SectionTitle>
          {form.application.employers.map((emp, idx) => (
            <div key={idx} className="grid grid-cols-2 gap-2 rounded-md border p-3">
              <p className="col-span-2 text-xs font-medium">
                {t("auth.onboard.employerN", { n: idx + 1 })}
              </p>
              <Input
                placeholder={t("auth.onboard.employerName")}
                value={emp.name ?? ""}
                onChange={(e) => {
                  const employers = [...form.application.employers];
                  employers[idx] = { ...emp, name: e.target.value || null };
                  updateApp("employers", employers);
                }}
              />
              <Input
                placeholder={t("auth.onboard.employerPhone")}
                value={emp.telephone ?? ""}
                onChange={(e) => {
                  const employers = [...form.application.employers];
                  employers[idx] = { ...emp, telephone: e.target.value || null };
                  updateApp("employers", employers);
                }}
              />
              <div className="col-span-2">
                <Input
                  placeholder={t("auth.onboard.employerAddress")}
                  value={emp.address ?? ""}
                  onChange={(e) => {
                    const employers = [...form.application.employers];
                    employers[idx] = { ...emp, address: e.target.value || null };
                    updateApp("employers", employers);
                  }}
                />
              </div>
              <Input
                placeholder={t("auth.onboard.employerSupervisor")}
                value={emp.supervisor ?? ""}
                onChange={(e) => {
                  const employers = [...form.application.employers];
                  employers[idx] = { ...emp, supervisor: e.target.value || null };
                  updateApp("employers", employers);
                }}
              />
              <Input
                placeholder={t("auth.onboard.employerPosition")}
                value={emp.position ?? ""}
                onChange={(e) => {
                  const employers = [...form.application.employers];
                  employers[idx] = { ...emp, position: e.target.value || null };
                  updateApp("employers", employers);
                }}
              />
              <Field label={t("auth.onboard.startDate")}>
                <Input
                  type="month"
                  lang={locale}
                  value={emp.startDate ?? ""}
                  onChange={(e) => {
                    const employers = [...form.application.employers];
                    employers[idx] = { ...emp, startDate: e.target.value || null };
                    updateApp("employers", employers);
                  }}
                />
              </Field>
              <Field label={t("auth.onboard.endDate")}>
                <Input
                  type="month"
                  lang={locale}
                  value={emp.endDate ?? ""}
                  onChange={(e) => {
                    const employers = [...form.application.employers];
                    employers[idx] = { ...emp, endDate: e.target.value || null };
                    updateApp("employers", employers);
                  }}
                />
              </Field>
              <div className="col-span-2">
                <Input
                  placeholder={t("auth.onboard.reasonLeaving")}
                  value={emp.reasonForLeaving ?? ""}
                  onChange={(e) => {
                    const employers = [...form.application.employers];
                    employers[idx] = { ...emp, reasonForLeaving: e.target.value || null };
                    updateApp("employers", employers);
                  }}
                />
              </div>
            </div>
          ))}

          <SectionTitle>{t("auth.onboard.militarySection")}</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <YesNo
              label={t("auth.onboard.militaryService")}
              value={form.application.militaryService}
              onChange={(v) => updateApp("militaryService", v)}
            />
            <Field label={t("auth.onboard.militaryBranch")}>
              <Input
                value={form.application.militaryBranch ?? ""}
                onChange={(e) => updateApp("militaryBranch", e.target.value)}
              />
            </Field>
            <div className="col-span-2">
              <Field label={t("auth.onboard.militaryTraining")}>
                <Input
                  value={form.application.militaryTraining ?? ""}
                  onChange={(e) => updateApp("militaryTraining", e.target.value)}
                />
              </Field>
            </div>
            <YesNo
              label={t("auth.onboard.felony")}
              value={form.application.felony}
              onChange={(v) => updateApp("felony", v)}
            />
            <div className="col-span-2">
              <Field label={t("auth.onboard.felonyExplain")}>
                <Textarea
                  value={form.application.felonyExplain ?? ""}
                  onChange={(e) => updateApp("felonyExplain", e.target.value)}
                  rows={2}
                />
              </Field>
            </div>
          </div>

          <SectionTitle>{t("auth.onboard.referencesSection")}</SectionTitle>
          {form.application.references.map((ref, idx) => (
            <div key={idx} className="grid grid-cols-2 gap-2 rounded-md border p-3">
              <Input
                placeholder={t("auth.onboard.referenceName")}
                value={ref.name ?? ""}
                onChange={(e) => {
                  const references = [...form.application.references];
                  references[idx] = { ...ref, name: e.target.value || null };
                  updateApp("references", references);
                }}
              />
              <Input
                placeholder={t("auth.onboard.referenceTitle")}
                value={ref.title ?? ""}
                onChange={(e) => {
                  const references = [...form.application.references];
                  references[idx] = { ...ref, title: e.target.value || null };
                  updateApp("references", references);
                }}
              />
              <Input
                placeholder={t("auth.onboard.referenceCompany")}
                value={ref.company ?? ""}
                onChange={(e) => {
                  const references = [...form.application.references];
                  references[idx] = { ...ref, company: e.target.value || null };
                  updateApp("references", references);
                }}
              />
              <Input
                placeholder={t("auth.onboard.referenceContact")}
                value={ref.contact ?? ""}
                onChange={(e) => {
                  const references = [...form.application.references];
                  references[idx] = { ...ref, contact: e.target.value || null };
                  updateApp("references", references);
                }}
              />
            </div>
          ))}
          <Field label={t("auth.onboard.comments")}>
            <Textarea
              value={form.application.comments ?? ""}
              onChange={(e) => updateApp("comments", e.target.value)}
              rows={3}
            />
          </Field>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <ConsentBlock
            title={t("auth.onboard.drugConsentTitle")}
            body={DRUG_ALCOHOL_CONSENT_TEXT}
            printedName={form.drugPrintedName}
            accepted={form.drugAccepted}
            onName={(v) => update("drugPrintedName", v)}
            onAccept={(v) => update("drugAccepted", v)}
            nameLabel={t("auth.onboard.typedFullName")}
            acceptLabel={t("auth.onboard.acceptDrug")}
          />
          <ConsentBlock
            title={t("auth.onboard.backgroundConsentTitle")}
            body={BACKGROUND_CHECK_CONSENT_TEXT}
            printedName={form.backgroundPrintedName}
            accepted={form.backgroundAccepted}
            onName={(v) => update("backgroundPrintedName", v)}
            onAccept={(v) => update("backgroundAccepted", v)}
            nameLabel={t("auth.onboard.typedFullName")}
            acceptLabel={t("auth.onboard.acceptBackground")}
          />
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
            {DIRECT_DEPOSIT_ACK_TEXT}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("auth.onboard.bankName")}>
              <Input
                value={form.ddBankName}
                onChange={(e) => update("ddBankName", e.target.value)}
                required
              />
            </Field>
            <Field label={t("auth.onboard.bankLocation")}>
              <Input
                value={form.ddBankLocation}
                onChange={(e) => update("ddBankLocation", e.target.value)}
              />
            </Field>
            <Field label={t("auth.onboard.routingNumber")}>
              <Input
                value={form.ddRouting}
                onChange={(e) =>
                  update("ddRouting", e.target.value.replace(/\D/g, "").slice(0, 9))
                }
                inputMode="numeric"
                maxLength={9}
                required
              />
            </Field>
            <Field label={t("auth.onboard.accountNumber")}>
              <Input
                value={form.ddAccount}
                onChange={(e) => update("ddAccount", e.target.value.replace(/\s/g, ""))}
                required
              />
            </Field>
            <Field label={t("auth.onboard.accountType")}>
              <Select
                value={form.ddAccountType}
                onValueChange={(v) => update("ddAccountType", v as "CHECKING" | "SAVINGS")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CHECKING">{t("auth.onboard.checking")}</SelectItem>
                  <SelectItem value="SAVINGS">{t("auth.onboard.savings")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("auth.onboard.typedFullName")}>
              <Input
                value={form.ddPrintedName}
                onChange={(e) => update("ddPrintedName", e.target.value)}
                placeholder={form.name}
              />
            </Field>
          </div>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.ddAccepted}
              onChange={(e) => update("ddAccepted", e.target.checked)}
            />
            <span>{t("auth.onboard.acceptDirectDeposit")}</span>
          </label>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-3">
          {handbookTemplates.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {handbookTemplates.map((h) => (
                <li key={h.checklistItemId} className="rounded-md border p-3">
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="handbook"
                      className="mt-1"
                      checked={form.handbookChecklistItemId === h.checklistItemId}
                      onChange={() => update("handbookChecklistItemId", h.checklistItemId)}
                    />
                    <span>
                      <span className="font-medium">{h.title}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {t("auth.onboard.version")} {h.version}
                      </span>
                      <br />
                      <a
                        href={h.downloadHref}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary hover:underline"
                      >
                        {t("auth.onboard.downloadHandbook")}
                      </a>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">{t("auth.onboard.handbookNoTemplate")}</p>
          )}
          <Field label={t("auth.onboard.typedFullName")}>
            <Input
              value={form.handbookPrintedName}
              onChange={(e) => update("handbookPrintedName", e.target.value)}
              placeholder={form.name}
            />
          </Field>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.handbookAccepted}
              onChange={(e) => update("handbookAccepted", e.target.checked)}
            />
            <span>{t("auth.onboard.acceptHandbook")}</span>
          </label>
        </div>
      )}

      {step === 6 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t("auth.onboard.uploadHelpI9W4")}</p>
          <p className="text-[11px] text-muted-foreground">
            I-9:{" "}
            <a
              className="text-primary hover:underline"
              href="https://www.uscis.gov/sites/default/files/document/forms/i-9.pdf"
              target="_blank"
              rel="noreferrer"
            >
              uscis.gov I-9
            </a>
            {" · "}
            W-4:{" "}
            <a
              className="text-primary hover:underline"
              href="https://www.irs.gov/pub/irs-pdf/fw4.pdf"
              target="_blank"
              rel="noreferrer"
            >
              irs.gov W-4
            </a>
          </p>
          {DOCUMENT_SLOTS.map((slot) => (
            <FileSlot
              key={slot.id}
              label={t(`auth.onboard.doc.${slot.id}`)}
              uploadLabel={t("auth.onboard.upload")}
              clearLabel={t("auth.onboard.clearUpload")}
              file={files[slot.id] ?? null}
              formatFileSize={(size) =>
                t("auth.onboard.fileSize", {
                  size: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
                    size / 1024,
                  ),
                })
              }
              onPick={(list) => onPick(slot.id, list)}
              onClear={() => setFiles((p) => ({ ...p, [slot.id]: null }))}
            />
          ))}
        </div>
      )}

      {step === 7 && (
        <div className="space-y-3">
          {submitError && (
            <Alert variant="destructive" className="py-2.5">
              <AlertDescription className="text-xs">
                {errorMessage(submitError)}
              </AlertDescription>
            </Alert>
          )}
          <p className="text-xs text-muted-foreground">{t("auth.onboard.createAccountHelp")}</p>
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="border-t pt-3 text-sm font-medium">{children}</p>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function OptionSelect({
  value,
  onChange,
  options,
  allowEmpty = false,
  placeholder = "—",
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  allowEmpty?: boolean;
  placeholder?: string;
}) {
  return (
    <Select value={value || NONE} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowEmpty && <SelectItem value={NONE}>{placeholder}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function StateSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <OptionSelect
      value={value || NONE}
      onChange={(v) => onChange(v === NONE ? "" : v)}
      options={US_STATES.map((s) => ({
        value: s.code,
        label: `${s.code} — ${s.name}`,
      }))}
      allowEmpty
    />
  );
}

function YesNo({
  label,
  value,
  onChange,
}: {
  label: string;
  value: "YES" | "NO" | null | undefined;
  onChange: (v: "YES" | "NO" | null) => void;
}) {
  return (
    <Field label={label}>
      <Select
        value={value ?? NONE}
        onValueChange={(v) => onChange(v === NONE ? null : (v as "YES" | "NO"))}
      >
        <SelectTrigger>
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>—</SelectItem>
          <SelectItem value="YES">Yes</SelectItem>
          <SelectItem value="NO">No</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

function ConsentBlock({
  title,
  body,
  printedName,
  accepted,
  onName,
  onAccept,
  nameLabel,
  acceptLabel,
}: {
  title: string;
  body: string;
  printedName: string;
  accepted: boolean;
  onName: (v: string) => void;
  onAccept: (v: boolean) => void;
  nameLabel: string;
  acceptLabel: string;
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium">{title}</p>
      <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
        {body}
      </p>
      <Field label={nameLabel}>
        <Input value={printedName} onChange={(e) => onName(e.target.value)} />
      </Field>
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={accepted}
          onChange={(e) => onAccept(e.target.checked)}
        />
        <span>{acceptLabel}</span>
      </label>
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
  hasHandbookTemplate: boolean,
): string | null {
  switch (step) {
    case 0:
      if (!f.name || f.name.length < 2) return t("auth.onboard.validation.fullName");
      if (!/^\d{4}$/.test(f.ssnLast4 ?? "")) return t("auth.onboard.validation.ssn");
      return null;
    case 3:
      if (!f.drugAccepted || f.drugPrintedName.trim().length < 2)
        return t("auth.onboard.validation.drugConsent");
      if (!f.backgroundAccepted || f.backgroundPrintedName.trim().length < 2)
        return t("auth.onboard.validation.backgroundConsent");
      return null;
    case 4:
      if (f.ddBankName.trim().length < 2) return t("auth.onboard.validation.bankName");
      if (!/^\d{9}$/.test(f.ddRouting.trim())) return t("auth.onboard.validation.routing");
      if (f.ddAccount.trim().length < 4) return t("auth.onboard.validation.account");
      if (!f.ddAccepted || (f.ddPrintedName.trim() || f.name.trim()).length < 2)
        return t("auth.onboard.validation.ddAck");
      return null;
    case 5:
      if (!f.handbookAccepted) return t("auth.onboard.validation.handbook");
      if ((f.handbookPrintedName.trim() || f.name.trim()).length < 2)
        return t("auth.onboard.validation.handbookName");
      if (hasHandbookTemplate && !f.handbookChecklistItemId)
        return t("auth.onboard.validation.handbookPick");
      return null;
    case 7:
      if (!f.email.trim() && !f.username.trim())
        return t("auth.onboard.validation.emailOrUsername");
      if (
        f.username.trim() &&
        !/^[a-z0-9._-]{3,32}$/.test(f.username.trim().toLowerCase())
      )
        return t("auth.onboard.validation.username");
      if (!f.password || f.password.length < 8) return t("auth.onboard.validation.password");
      return null;
    default:
      return null;
  }
}
