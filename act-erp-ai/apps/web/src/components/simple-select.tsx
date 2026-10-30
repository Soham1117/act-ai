"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type SimpleSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SimpleSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: SimpleSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  id?: string;
  /** Radix Select forbids empty string as Item value; map "" → this sentinel. */
  emptyValue?: string;
  "aria-label"?: string;
};

const DEFAULT_EMPTY = "__all__";

export function SimpleSelect({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  disabled,
  className,
  triggerClassName,
  id,
  emptyValue = DEFAULT_EMPTY,
  "aria-label": ariaLabel,
}: SimpleSelectProps) {
  const mapped = options.map((o) => ({
    ...o,
    value: o.value === "" ? emptyValue : o.value,
  }));
  const current = value === "" ? emptyValue : value;

  return (
    <Select
      value={current}
      onValueChange={(v) => onValueChange(v === emptyValue ? "" : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn(className, triggerClassName)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {mapped.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** GET/POST forms: shadcn Select + hidden input so `name` submits. */
export function FormSimpleSelect({
  name,
  defaultValue = "",
  options,
  placeholder,
  disabled,
  className,
  triggerClassName,
  id,
  emptyValue,
  "aria-label": ariaLabel,
}: Omit<SimpleSelectProps, "value" | "onValueChange"> & {
  name: string;
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <SimpleSelect
        id={id}
        value={value}
        onValueChange={setValue}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        triggerClassName={triggerClassName}
        emptyValue={emptyValue}
        aria-label={ariaLabel}
      />
    </>
  );
}
