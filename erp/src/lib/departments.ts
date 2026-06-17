import {
  Users,
  Wrench,
  Cog,
  BadgeDollarSign,
  Phone,
  Factory,
  Briefcase,
  Warehouse,
  Boxes,
  type LucideIcon,
} from "lucide-react";

export type DepartmentConfig = {
  label: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
};

/**
 * The 8 fixed departments. Keys are also the canonical `Department.name` in
 * the database — display labels can differ (e.g. "InsideSales" → "Inside Sales").
 */
export const DEPARTMENTS: Record<string, DepartmentConfig> = {
  Admin:         { label: "Admin",         icon: Users,             color: "text-purple-500",  bgColor: "bg-purple-500/10"  },
  Assembly:      { label: "Assembly",      icon: Wrench,            color: "text-blue-500",    bgColor: "bg-blue-500/10"    },
  Engineering:   { label: "Engineering",   icon: Cog,               color: "text-emerald-500", bgColor: "bg-emerald-500/10" },
  Sales:         { label: "Sales",         icon: BadgeDollarSign,   color: "text-green-500",   bgColor: "bg-green-500/10"   },
  InsideSales:   { label: "Inside Sales",  icon: Phone,             color: "text-teal-500",    bgColor: "bg-teal-500/10"    },
  Manufacturing: { label: "Manufacturing", icon: Factory,           color: "text-orange-500",  bgColor: "bg-orange-500/10"  },
  Operations:    { label: "Operations",    icon: Briefcase,         color: "text-indigo-500",  bgColor: "bg-indigo-500/10"  },
  Warehouse:     { label: "Warehouse",     icon: Warehouse,         color: "text-amber-500",   bgColor: "bg-amber-500/10"   },
};

const FALLBACK: DepartmentConfig = {
  label: "Unknown",
  icon: Boxes,
  color: "text-gray-500",
  bgColor: "bg-gray-500/10",
};

export function getDepartmentConfig(name: string | null | undefined): DepartmentConfig {
  if (!name) return FALLBACK;
  return DEPARTMENTS[name] ?? { ...FALLBACK, label: name };
}

export const DEPARTMENT_NAMES = Object.keys(DEPARTMENTS) as Array<keyof typeof DEPARTMENTS>;
