"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  InlinePanel,
  InlinePanelContent,
  InlinePanelDescription,
  InlinePanelFooter,
  InlinePanelHeader,
  InlinePanelTitle,
  InlinePanelTrigger,
} from "@/components/inline-panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createEmployee } from "@/server/actions/employees";
import { runAction, toastAction } from "@/lib/toast-action";
import { formatMoneyInput, parseMoneyInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AdminPasswordField } from "./password-field";

const NONE = "__none__";

const COMP_PLACEHOLDER = {
  HOURLY_RATE: "25.00",
  MONTHLY_SALARY: "5,000",
  TOTAL_COMPENSATION: "60,000",
} as const;
const COMP_SUFFIX = {
  HOURLY_RATE: "/ hr",
  MONTHLY_SALARY: "/ month",
  TOTAL_COMPENSATION: "",
} as const;

const optionalEmail = z
  .string()
  .trim()
  .email()
  .optional()
  .or(z.literal("").transform(() => undefined));

const schema = z
  .object({
    name: z.string().min(2, "At least 2 characters"),
    email: optionalEmail,
    username: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{3,32}$/, "Letters, numbers, . _ - only, 3-32 chars")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    personalEmail: optionalEmail,
    ssnLast4: z
      .string()
      .regex(/^\d{4}$/, "Enter exactly 4 digits")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    password: z.string().min(8, "Min 8 characters"),
    gender: z.enum(["MALE", "FEMALE", "OTHER"]),
    departmentId: z.string(),
    jobTitle: z.string().optional(),
    phoneNumber: z.string().optional(),
    address: z.string().optional(),
    address2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().max(50).optional(),
    zipCode: z.string().max(20).optional(),
    employmentType: z.enum(["FULL_PART_TIME", "CONTRACT_HOURLY"]),
    compensationType: z.enum(["MONTHLY_SALARY", "HOURLY_RATE", "TOTAL_COMPENSATION"]),
    compensationValue: z.string().optional(),
  })
  .refine((value) => value.email || value.username, {
    message: "Enter a username when no company email is provided",
    path: ["username"],
  });

type Values = z.infer<typeof schema>;

const defaults: Values = {
  name: "",
  email: "",
  username: "",
  personalEmail: "",
  ssnLast4: "",
  password: "",
  gender: "MALE",
  departmentId: NONE,
  jobTitle: "",
  phoneNumber: "",
  address: "",
  address2: "",
  city: "",
  state: "",
  zipCode: "",
  employmentType: "FULL_PART_TIME",
  compensationType: "HOURLY_RATE",
  compensationValue: "",
};

export function AddEmployeePanel({
  departments,
}: {
  departments: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });

  function onSubmit(values: Values) {
    startTransition(async () => {
      const res = await runAction(() => createEmployee({
        ...values,
        departmentId: values.departmentId === NONE ? null : values.departmentId,
        jobTitle: values.jobTitle || null,
        phoneNumber: values.phoneNumber || null,
        address: values.address || null,
        address2: values.address2 || null,
        city: values.city || null,
        state: values.state || null,
        zipCode: values.zipCode || null,
        compensationValue: parseMoneyInput(values.compensationValue ?? ""),
      }));
      if (!toastAction(res)) return;
      toast.success(`Created ${values.name}`);
      setOpen(false);
      form.reset(defaults);
    });
  }

  const errors = form.formState.errors;
  const compensationType = form.watch("compensationType");
  const compSuffix = COMP_SUFFIX[compensationType];

  return (
    <InlinePanel disabled={pending}
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) form.reset(defaults);
      }}
    >
      <InlinePanelTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Add employee
        </Button>
      </InlinePanelTrigger>
      <InlinePanelContent panelSlot="add-employee">
        <InlinePanelHeader>
          <InlinePanelTitle>New employee</InlinePanelTitle>
          <InlinePanelDescription>
            Creates a login with a temporary password the employee changes at first
            sign-in. To let the hire fill in their own details, send an onboarding
            invite instead.
          </InlinePanelDescription>
        </InlinePanelHeader>
        {/* Full width: sections sit 2×2 on large screens, stacked below that. */}
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-x-10 lg:gap-y-6"
        >
          <Section title="Sign-in">
            <Field
              id="ae-name"
              label="Full name"
              required
              className="sm:col-span-2"
              error={errors.name?.message}
            >
              <Input id="ae-name" {...form.register("name")} />
            </Field>
            <Field
              id="ae-email"
              label="Company email (optional)"
              hint="Emails and usernames are saved in lowercase."
              error={errors.email?.message}
            >
              <Input id="ae-email" type="email" {...form.register("email")} />
            </Field>
            <Field
              id="ae-username"
              label="Username (only if no company email)"
              hint="Required if no company email."
              error={errors.username?.message}
            >
              <Input id="ae-username" {...form.register("username")} placeholder="jsmith" />
            </Field>
            <Field
              id="ae-password"
              label="Temporary password"
              required
              className="sm:col-span-2"
              error={errors.password?.message}
            >
              <AdminPasswordField
                id="ae-password"
                value={form.watch("password")}
                onChange={(v) =>
                  form.setValue("password", v, { shouldDirty: true, shouldValidate: true })
                }
              />
            </Field>
          </Section>

          <Section title="Personal">
            <Field
              id="ae-personal-email"
              label="Personal email"
              error={errors.personalEmail?.message}
            >
              <Input id="ae-personal-email" type="email" {...form.register("personalEmail")} />
            </Field>
            <Field id="ae-phone" label="Phone">
              <Input
                id="ae-phone"
                {...form.register("phoneNumber")}
                placeholder="(281) 555-0142"
              />
            </Field>
            <Field label="Gender">
              <Select
                value={form.watch("gender")}
                onValueChange={(v) => form.setValue("gender", v as Values["gender"])}
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
            <Field id="ae-ssn" label="SSN — last 4 only" error={errors.ssnLast4?.message}>
              <Input
                id="ae-ssn"
                {...form.register("ssnLast4")}
                inputMode="numeric"
                maxLength={4}
                placeholder="6789"
              />
            </Field>
          </Section>

          <Section title="Address" gridClassName="sm:grid-cols-[2fr_1fr_1fr]">
            <Field id="ae-address" label="Address line 1" className="sm:col-span-3">
              <Input id="ae-address" {...form.register("address")} autoComplete="address-line1" />
            </Field>
            <Field id="ae-address2" label="Address line 2" className="sm:col-span-3">
              <Input
                id="ae-address2"
                {...form.register("address2")}
                autoComplete="address-line2"
              />
            </Field>
            <Field id="ae-city" label="City">
              <Input id="ae-city" {...form.register("city")} autoComplete="address-level2" />
            </Field>
            <Field id="ae-state" label="State">
              <Input id="ae-state" {...form.register("state")} autoComplete="address-level1" />
            </Field>
            <Field id="ae-zip" label="ZIP code">
              <Input id="ae-zip" {...form.register("zipCode")} autoComplete="postal-code" />
            </Field>
          </Section>

          <Section title="Job & pay">
            <Field label="Department">
              <Select
                value={form.watch("departmentId")}
                onValueChange={(v) => form.setValue("departmentId", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="(none)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>(none)</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="ae-job-title" label="Job title">
              <Input id="ae-job-title" {...form.register("jobTitle")} />
            </Field>
            <Field label="Employment type">
              <Select
                value={form.watch("employmentType")}
                onValueChange={(v) =>
                  form.setValue("employmentType", v as Values["employmentType"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FULL_PART_TIME">Full-time / Part-time</SelectItem>
                  <SelectItem value="CONTRACT_HOURLY">Contract / Hourly</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Compensation type">
              <Select
                value={compensationType}
                onValueChange={(v) =>
                  form.setValue("compensationType", v as Values["compensationType"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HOURLY_RATE">Hourly rate</SelectItem>
                  <SelectItem value="MONTHLY_SALARY">Monthly salary</SelectItem>
                  <SelectItem value="TOTAL_COMPENSATION">Total compensation</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field
              id="ae-comp-value"
              label="Compensation value"
              error={errors.compensationValue?.message}
            >
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id="ae-comp-value"
                  type="text"
                  inputMode="decimal"
                  className={compSuffix ? "pl-6 pr-16" : "pl-6"}
                  placeholder={COMP_PLACEHOLDER[compensationType]}
                  value={form.watch("compensationValue") ?? ""}
                  onChange={(e) =>
                    form.setValue("compensationValue", formatMoneyInput(e.target.value), {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                />
                {compSuffix && (
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    {compSuffix}
                  </span>
                )}
              </div>
            </Field>
          </Section>

          <InlinePanelFooter className="pt-2 lg:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </InlinePanelFooter>
        </form>
      </InlinePanelContent>
    </InlinePanel>
  );
}

function Section({
  title,
  gridClassName = "sm:grid-cols-2",
  children,
}: {
  title: string;
  gridClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 border-t pt-4">
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className={cn("grid grid-cols-1 gap-3", gridClassName)}>{children}</div>
    </section>
  );
}

function Field({
  label,
  id,
  hint,
  required,
  className,
  error,
  children,
}: {
  label: string;
  id?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {/* CSS star with empty alt text: label text and accessible name stay exact
          (e2e textField() matches label text verbatim). */}
      <Label
        htmlFor={id}
        className={cn(
          "text-xs",
          required && "after:ml-0.5 after:text-destructive after:[content:'*'_/_'']",
        )}
      >
        {label}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
