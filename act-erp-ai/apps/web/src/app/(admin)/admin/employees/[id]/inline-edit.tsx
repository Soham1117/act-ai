"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { Pencil, Loader2, Save, X, Camera } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateEmployee, updateEmployeeProfilePic } from "@/server/actions/employees";
import { toastAction } from "@/lib/toast-action";

const NONE = "__none__";

type Option = { id: string; name: string };
type JobCodeOpt = { id: string; code: string; title: string };

/** ----------------- Profile picture (sidebar) ----------------- */

export function ProfilePicEditor({
  employeeId,
  employeeName,
  initialAvatar,
}: {
  employeeId: string;
  employeeName: string;
  initialAvatar: string;
}) {
  const [avatar, setAvatar] = useState(initialAvatar);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function onPick(file: File | null) {
    if (!file) return;
    startTransition(async () => {
      const bytes = await file.arrayBuffer();
      const res = await updateEmployeeProfilePic(employeeId, {
        name: file.name,
        type: file.type || "image/jpeg",
        bytes,
      });
      if (!toastAction(res)) return;
      setAvatar(res.url);
      toast.success("Profile picture updated");
    });
  }

  return (
    <span className="group relative h-24 w-24 overflow-hidden rounded-full ring-2 ring-border">
      <Image
        src={avatar}
        alt={employeeName}
        fill
        sizes="96px"
        className="object-cover"
        unoptimized
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={pending}
        className="absolute inset-0 grid place-items-center bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-100"
      >
        {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
    </span>
  );
}

/** ----------------- Generic editable card ----------------- */

function EditableCard({
  title,
  editing,
  setEditing,
  pending,
  onSave,
  view,
  edit,
}: {
  title: string;
  editing: boolean;
  setEditing: (v: boolean) => void;
  pending: boolean;
  onSave: () => void;
  view: React.ReactNode;
  edit: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        {editing ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              <X className="mr-1 h-3.5 w-3.5" /> Cancel
            </Button>
            <Button size="sm" onClick={onSave} disabled={pending}>
              {pending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1 h-3.5 w-3.5" />
              )}
              Save
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className={editing ? "grid grid-cols-2 gap-3 text-sm" : "grid grid-cols-2 gap-x-6 gap-y-3 text-sm"}>
        {editing ? edit : view}
      </CardContent>
    </Card>
  );
}

function ViewField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={mono ? "font-mono text-sm" : "text-sm"}>{value ?? "—"}</p>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function EditSelect({
  label,
  value,
  onChange,
  options,
  allowNone = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  allowNone?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allowNone && <SelectItem value={NONE}>—</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** ----------------- Personal section ----------------- */

type PersonalValues = {
  gender: "MALE" | "FEMALE" | "OTHER";
  maritalStatus: string;
  dateOfBirth: string;
  nationality: string;
  educationLevel: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  phoneNumber: string;
  emergencyName: string;
  emergencyPhone: string;
};

export function PersonalEditableCard({
  employeeId,
  initial,
  ssnMasked,
}: {
  employeeId: string;
  initial: PersonalValues;
  ssnMasked: string;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState(initial);

  function set<K extends keyof PersonalValues>(k: K, v: PersonalValues[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function save() {
    startTransition(async () => {
      const res = await updateEmployee(employeeId, {
        gender: form.gender,
        maritalStatus: (form.maritalStatus || null) as
          | "SINGLE" | "MARRIED" | "DIVORCED" | "WIDOWED" | "SEPARATED" | "OTHER" | null,
        dateOfBirth: form.dateOfBirth || null,
        nationality: form.nationality || null,
        educationLevel: form.educationLevel || null,
        address: form.address || null,
        city: form.city || null,
        state: form.state || null,
        zipCode: form.zipCode || null,
        phoneNumber: form.phoneNumber || null,
        emergencyName: form.emergencyName || null,
        emergencyPhone: form.emergencyPhone || null,
      });
      if (!toastAction(res)) return;
      toast.success("Saved");
      setEditing(false);
    });
  }

  return (
    <EditableCard
      title="Profile"
      editing={editing}
      setEditing={(v) => {
        setEditing(v);
        if (!v) setForm(initial);
      }}
      pending={pending}
      onSave={save}
      view={
        <>
          <ViewField label="Gender" value={initial.gender} />
          <ViewField label="Marital status" value={initial.maritalStatus} />
          <ViewField
            label="DOB"
            value={initial.dateOfBirth ? new Date(initial.dateOfBirth).toLocaleDateString() : null}
          />
          <ViewField label="Nationality" value={initial.nationality} />
          <ViewField label="Education" value={initial.educationLevel} />
          <ViewField label="Phone" value={initial.phoneNumber} />
          <ViewField label="Address" value={initial.address} />
          <ViewField
            label="City / State / Zip"
            value={[initial.city, initial.state, initial.zipCode].filter(Boolean).join(", ") || null}
          />
          <ViewField label="SSN" value={ssnMasked} mono />
          <ViewField
            label="Emergency contact"
            value={
              initial.emergencyName
                ? `${initial.emergencyName} · ${initial.emergencyPhone}`
                : null
            }
          />
        </>
      }
      edit={
        <>
          <EditSelect
            label="Gender"
            value={form.gender}
            onChange={(v) => set("gender", v as PersonalValues["gender"])}
            options={[
              { value: "MALE", label: "Male" },
              { value: "FEMALE", label: "Female" },
              { value: "OTHER", label: "Other" },
            ]}
          />
          <EditSelect
            label="Marital status"
            value={form.maritalStatus || NONE}
            onChange={(v) => set("maritalStatus", v === NONE ? "" : v)}
            allowNone
            options={[
              { value: "SINGLE", label: "Single" },
              { value: "MARRIED", label: "Married" },
              { value: "DIVORCED", label: "Divorced" },
              { value: "WIDOWED", label: "Widowed" },
              { value: "SEPARATED", label: "Separated" },
              { value: "OTHER", label: "Other" },
            ]}
          />
          <EditField label="DOB" type="date" value={form.dateOfBirth?.slice(0, 10) ?? ""} onChange={(v) => set("dateOfBirth", v)} />
          <EditField label="Nationality" value={form.nationality} onChange={(v) => set("nationality", v)} />
          <EditField label="Education" value={form.educationLevel} onChange={(v) => set("educationLevel", v)} />
          <EditField label="Phone" value={form.phoneNumber} onChange={(v) => set("phoneNumber", v)} />
          <EditField label="Address" value={form.address} onChange={(v) => set("address", v)} />
          <EditField label="City" value={form.city} onChange={(v) => set("city", v)} />
          <EditField label="State" value={form.state} onChange={(v) => set("state", v)} />
          <EditField label="Zip" value={form.zipCode} onChange={(v) => set("zipCode", v)} />
          <EditField label="Emergency name" value={form.emergencyName} onChange={(v) => set("emergencyName", v)} />
          <EditField label="Emergency phone" value={form.emergencyPhone} onChange={(v) => set("emergencyPhone", v)} />
        </>
      }
    />
  );
}

/** ----------------- Employment section ----------------- */

type EmploymentValues = {
  jobTitle: string;
  position: string;
  jobDescription: string;
  dateOfHire: string;
  employmentType: "FULL_PART_TIME" | "CONTRACT_HOURLY";
  workEmail: string;
  workPhoneNumber: string;
  departmentId: string;
  supervisorId: string;
};

export function EmploymentEditableCard({
  employeeId,
  initial,
  initialDepartmentName,
  initialSupervisorName,
  departments,
  supervisors,
  terminationInfo,
}: {
  employeeId: string;
  initial: EmploymentValues;
  initialDepartmentName: string | null;
  initialSupervisorName: string | null;
  departments: Option[];
  supervisors: Option[];
  terminationInfo: { date: string | null; reason: string | null };
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    ...initial,
    departmentId: initial.departmentId || NONE,
    supervisorId: initial.supervisorId || NONE,
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function save() {
    startTransition(async () => {
      const res = await updateEmployee(employeeId, {
        jobTitle: form.jobTitle || null,
        position: form.position || null,
        jobDescription: form.jobDescription || null,
        dateOfHire: form.dateOfHire || null,
        employmentType: form.employmentType,
        workEmail: form.workEmail || null,
        workPhoneNumber: form.workPhoneNumber || null,
        departmentId: form.departmentId === NONE ? null : form.departmentId,
        supervisorId: form.supervisorId === NONE ? null : form.supervisorId,
      });
      if (!toastAction(res)) return;
      toast.success("Saved");
      setEditing(false);
    });
  }

  return (
    <EditableCard
      title="Employment"
      editing={editing}
      setEditing={(v) => {
        setEditing(v);
        if (!v) {
          setForm({
            ...initial,
            departmentId: initial.departmentId || NONE,
            supervisorId: initial.supervisorId || NONE,
          });
        }
      }}
      pending={pending}
      onSave={save}
      view={
        <>
          <ViewField label="Department" value={initialDepartmentName} />
          <ViewField label="Job title" value={initial.jobTitle} />
          <ViewField label="Position" value={initial.position} />
          <ViewField label="Supervisor" value={initialSupervisorName} />
          <ViewField
            label="Date of hire"
            value={initial.dateOfHire ? new Date(initial.dateOfHire).toLocaleDateString() : null}
          />
          <ViewField label="Type" value={initial.employmentType.replace("_", " / ")} />
          <ViewField label="Work email" value={initial.workEmail} />
          <ViewField label="Work phone" value={initial.workPhoneNumber} />
          <ViewField
            label="Termination date"
            value={terminationInfo.date ? new Date(terminationInfo.date).toLocaleDateString() : null}
          />
          <ViewField label="Termination reason" value={terminationInfo.reason} />
          <div className="col-span-2">
            <ViewField label="Job description" value={initial.jobDescription} />
          </div>
        </>
      }
      edit={
        <>
          <EditSelect
            label="Department"
            value={form.departmentId}
            onChange={(v) => set("departmentId", v)}
            allowNone
            options={departments.map((d) => ({ value: d.id, label: d.name }))}
          />
          <EditField label="Job title" value={form.jobTitle} onChange={(v) => set("jobTitle", v)} />
          <EditField label="Position" value={form.position} onChange={(v) => set("position", v)} />
          <EditSelect
            label="Supervisor"
            value={form.supervisorId}
            onChange={(v) => set("supervisorId", v)}
            allowNone
            options={supervisors.map((s) => ({ value: s.id, label: s.name }))}
          />
          <EditField label="Date of hire" type="date" value={form.dateOfHire?.slice(0, 10) ?? ""} onChange={(v) => set("dateOfHire", v)} />
          <EditSelect
            label="Type"
            value={form.employmentType}
            onChange={(v) => set("employmentType", v as EmploymentValues["employmentType"])}
            options={[
              { value: "FULL_PART_TIME", label: "Full / Part time" },
              { value: "CONTRACT_HOURLY", label: "Contract / Hourly" },
            ]}
          />
          <EditField label="Work email" value={form.workEmail} onChange={(v) => set("workEmail", v)} />
          <EditField label="Work phone" value={form.workPhoneNumber} onChange={(v) => set("workPhoneNumber", v)} />
          <div className="col-span-2 space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Job description</Label>
            <Textarea
              rows={3}
              value={form.jobDescription}
              onChange={(e) => set("jobDescription", e.target.value)}
            />
          </div>
        </>
      }
    />
  );
}

/** ----------------- Compensation section ----------------- */

type CompValues = {
  compensationType: "MONTHLY_SALARY" | "HOURLY_RATE" | "TOTAL_COMPENSATION";
  compensationValue: string;
  defaultHourlyRate: string;
  primaryJobCodeId: string;
};

export function CompensationEditableCard({
  employeeId,
  initial,
  jobCodes,
}: {
  employeeId: string;
  initial: CompValues;
  jobCodes: JobCodeOpt[];
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    ...initial,
    primaryJobCodeId: initial.primaryJobCodeId || NONE,
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function save() {
    startTransition(async () => {
      const res = await updateEmployee(employeeId, {
        compensationType: form.compensationType,
        compensationValue: form.compensationValue ? Number(form.compensationValue) : null,
        defaultHourlyRate: form.defaultHourlyRate ? Number(form.defaultHourlyRate) : 0,
        primaryJobCodeId: form.primaryJobCodeId === NONE ? null : form.primaryJobCodeId,
      });
      if (!toastAction(res)) return;
      toast.success("Saved");
      setEditing(false);
    });
  }

  const primaryJobCodeLabel =
    jobCodes.find((j) => j.id === initial.primaryJobCodeId)?.code ?? null;

  return (
    <EditableCard
      title="Compensation"
      editing={editing}
      setEditing={(v) => {
        setEditing(v);
        if (!v) setForm({ ...initial, primaryJobCodeId: initial.primaryJobCodeId || NONE });
      }}
      pending={pending}
      onSave={save}
      view={
        <>
          <ViewField label="Type" value={initial.compensationType.replace(/_/g, " ")} />
          <ViewField label="Value" value={initial.compensationValue || null} />
          <ViewField label="Default hourly rate" value={`$${initial.defaultHourlyRate}/hr`} mono />
          <ViewField label="Primary job code" value={primaryJobCodeLabel} />
        </>
      }
      edit={
        <>
          <EditSelect
            label="Type"
            value={form.compensationType}
            onChange={(v) => set("compensationType", v as CompValues["compensationType"])}
            options={[
              { value: "MONTHLY_SALARY", label: "Monthly salary" },
              { value: "HOURLY_RATE", label: "Hourly rate" },
              { value: "TOTAL_COMPENSATION", label: "Total compensation" },
            ]}
          />
          <EditField
            label="Value"
            type="number"
            value={form.compensationValue}
            onChange={(v) => set("compensationValue", v)}
          />
          <EditField
            label="Default hourly rate"
            type="number"
            value={form.defaultHourlyRate}
            onChange={(v) => set("defaultHourlyRate", v)}
          />
          <EditSelect
            label="Primary job code"
            value={form.primaryJobCodeId}
            onChange={(v) => set("primaryJobCodeId", v)}
            allowNone
            options={jobCodes.map((j) => ({ value: j.id, label: `${j.code} — ${j.title}` }))}
          />
        </>
      }
    />
  );
}

/** ----------------- Name + employee ID (sidebar editable) ----------------- */

export function NameEditor({
  employeeId,
  initialName,
}: {
  employeeId: string;
  initialName: string;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [pending, startTransition] = useTransition();

  function save() {
    if (name.trim().length < 2) {
      toast.error("Name too short");
      return;
    }
    startTransition(async () => {
      const res = await updateEmployee(employeeId, { name: name.trim() });
      if (!toastAction(res)) return;
      toast.success("Saved");
      setEditing(false);
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group inline-flex items-center gap-1 text-lg font-bold hover:text-primary"
      >
        {initialName}
        <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
      </button>
    );
  }
  return (
    <div className="flex w-full items-center gap-1">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-8 text-sm"
        autoFocus
      />
      <Button size="icon" variant="ghost" onClick={save} disabled={pending}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        onClick={() => {
          setEditing(false);
          setName(initialName);
        }}
        disabled={pending}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
