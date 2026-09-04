"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { toastAction } from "@/lib/toast-action";
import { formatMoneyInput, parseMoneyInput } from "@/lib/format";

const NONE = "__none__";

const optionalEmail = z
  .string()
  .email()
  .optional()
  .or(z.literal("").transform(() => undefined));

const schema = z
  .object({
    name: z.string().min(2, "At least 2 characters"),
    email: optionalEmail,
    username: z
      .string()
      .regex(/^[a-z0-9._-]{3,32}$/, "Lowercase letters, numbers, . _ - only, 3-32 chars")
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
  employmentType: "FULL_PART_TIME",
  compensationType: "HOURLY_RATE",
  compensationValue: "",
};

export function AddEmployeeDialog({
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
      const res = await createEmployee({
        ...values,
        departmentId: values.departmentId === NONE ? null : values.departmentId,
        jobTitle: values.jobTitle || null,
        phoneNumber: values.phoneNumber || null,
        compensationValue: parseMoneyInput(values.compensationValue ?? ""),
      });
      if (!toastAction(res)) return;
      toast.success(`Created ${values.name}`);
      setOpen(false);
      form.reset(defaults);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) form.reset(defaults);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Add employee
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New employee</DialogTitle>
          <DialogDescription>
            Creates the auth account + employee record. Phase 6 onboarding will handle
            this via invite links instead.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full name" error={form.formState.errors.name?.message}>
              <Input {...form.register("name")} />
            </Field>
            <Field
              label="Company email (optional)"
              error={form.formState.errors.email?.message}
            >
              <Input type="email" {...form.register("email")} />
            </Field>
            <Field
              label="Username (only if no company email)"
              error={form.formState.errors.username?.message}
            >
              <Input {...form.register("username")} placeholder="jsmith" />
            </Field>
            <Field
              label="Personal email (optional)"
              error={form.formState.errors.personalEmail?.message}
            >
              <Input type="email" {...form.register("personalEmail")} />
            </Field>
            <Field
              label="SSN — last 4 only"
              error={form.formState.errors.ssnLast4?.message}
            >
              <Input
                {...form.register("ssnLast4")}
                inputMode="numeric"
                maxLength={4}
                placeholder="6789"
              />
            </Field>
            <Field label="Password" error={form.formState.errors.password?.message}>
              <Input type="text" {...form.register("password")} />
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
            <Field label="Phone">
              <Input {...form.register("phoneNumber")} placeholder="(281) 555-0142" />
            </Field>
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
            <Field label="Job title">
              <Input {...form.register("jobTitle")} />
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
                value={form.watch("compensationType")}
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
              label="Compensation value ($)"
              error={form.formState.errors.compensationValue?.message}
            >
              <Input
                type="text"
                inputMode="decimal"
                placeholder="60,000"
                value={form.watch("compensationValue") ?? ""}
                onChange={(e) =>
                  form.setValue("compensationValue", formatMoneyInput(e.target.value), {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              />
            </Field>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {error && <p className="text-[10px] text-destructive">{error}</p>}
    </div>
  );
}
