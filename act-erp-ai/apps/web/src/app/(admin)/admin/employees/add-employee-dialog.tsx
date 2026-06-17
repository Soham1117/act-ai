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

const schema = z.object({
  name: z.string().min(2, "At least 2 characters"),
  email: z.string().email(),
  ssn: z.string().min(9).max(11),
  password: z.string().min(8, "Min 8 characters"),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  departmentId: z.string().optional(),
  jobTitle: z.string().optional(),
  phoneNumber: z.string().optional(),
  employmentType: z.enum(["FULL_PART_TIME", "CONTRACT_HOURLY"]),
  compensationType: z.enum(["MONTHLY_SALARY", "HOURLY_RATE", "TOTAL_COMPENSATION"]),
  compensationValue: z.string().optional(),
});

type Values = z.infer<typeof schema>;

export function AddEmployeeDialog({
  departments,
}: {
  departments: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      gender: "MALE",
      employmentType: "FULL_PART_TIME",
      compensationType: "HOURLY_RATE",
    },
  });

  function onSubmit(values: Values) {
    startTransition(async () => {
      try {
        await createEmployee({
          ...values,
          departmentId: values.departmentId || null,
          jobTitle: values.jobTitle || null,
          phoneNumber: values.phoneNumber || null,
          compensationValue: values.compensationValue ? Number(values.compensationValue) : null,
        });
        toast.success(`Created ${values.name}`);
        setOpen(false);
        form.reset();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to create");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Add employee
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New employee</DialogTitle>
          <DialogDescription>
            Creates the auth account + employee record. Phase 6 onboarding will
            handle this via invite links instead.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full name" error={form.formState.errors.name?.message}>
              <Input {...form.register("name")} />
            </Field>
            <Field label="Email" error={form.formState.errors.email?.message}>
              <Input type="email" {...form.register("email")} />
            </Field>
            <Field label="SSN (any format)" error={form.formState.errors.ssn?.message}>
              <Input {...form.register("ssn")} placeholder="123-45-6789" />
            </Field>
            <Field label="Password" error={form.formState.errors.password?.message}>
              <Input type="text" {...form.register("password")} />
            </Field>
            <Field label="Gender">
              <Select
                value={form.watch("gender")}
                onValueChange={(v) => form.setValue("gender", v as Values["gender"])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
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
                <SelectTrigger><SelectValue placeholder="(none)" /></SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
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
                onValueChange={(v) => form.setValue("employmentType", v as Values["employmentType"])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="FULL_PART_TIME">Full-time / Part-time</SelectItem>
                  <SelectItem value="CONTRACT_HOURLY">Contract / Hourly</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Compensation type">
              <Select
                value={form.watch("compensationType")}
                onValueChange={(v) => form.setValue("compensationType", v as Values["compensationType"])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="HOURLY_RATE">Hourly rate</SelectItem>
                  <SelectItem value="MONTHLY_SALARY">Monthly salary</SelectItem>
                  <SelectItem value="TOTAL_COMPENSATION">Total compensation</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Compensation value ($)">
              <Input type="number" step="0.01" {...form.register("compensationValue")} />
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
