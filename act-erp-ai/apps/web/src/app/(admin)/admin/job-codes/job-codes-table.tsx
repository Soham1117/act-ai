"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Star, MoreHorizontal, ToggleLeft, ToggleRight, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteJobCode, toggleJobCodeActive } from "@/server/actions/job-codes";
import { toastAction } from "@/lib/toast-action";
import { JobCodeDialog } from "./job-code-dialog";
import { getDepartmentConfig } from "@/lib/departments";

export type Row = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  rate: string;
  isActive: boolean;
  isDefault: boolean;
  assignmentCount: number;
  departmentId: string | null;
  departmentName: string | null;
};

type Props = {
  rows: Row[];
  departments: Array<{ id: string; name: string }>;
};

export function JobCodesTable({ rows, departments }: Props) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Row | null>(null);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Department</TableHead>
            <TableHead className="text-right">Rate</TableHead>
            <TableHead className="text-right">Assigned</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((j) => {
            const cfg = j.departmentName ? getDepartmentConfig(j.departmentName) : null;
            const Icon = cfg?.icon;
            return (
              <TableRow key={j.id}>
                <TableCell className="font-mono text-sm">
                  <Link href={`/admin/job-codes/${j.id}`} className="inline-flex items-center gap-1.5 hover:underline">
                    {j.isDefault && <Star className="h-3 w-3 fill-primary text-primary" />}
                    {j.code}
                  </Link>
                </TableCell>
                <TableCell>
                  <p className="font-medium">{j.title}</p>
                  {j.description && (
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {j.description}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  {cfg && Icon ? (
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span className={`flex h-5 w-5 items-center justify-center rounded ${cfg.bgColor} ${cfg.color}`}>
                        <Icon className="h-3 w-3" />
                      </span>
                      <span>{cfg.label}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">{j.rate}</TableCell>
                <TableCell className="text-right tabular-nums">{j.assignmentCount}</TableCell>
                <TableCell>
                  <Badge variant={j.isActive ? "success" : "secondary"} className="text-[10px]">
                    {j.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" disabled={pending}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/admin/job-codes/${j.id}`}>View</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setEditing(j)}>
                        <Pencil className="mr-2 h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          startTransition(async () => {
                            const res = await toggleJobCodeActive(j.id);
                            if (!toastAction(res)) return;
                            toast.success(j.isActive ? "Deactivated" : "Activated");
                          })
                        }
                      >
                        {j.isActive ? (
                          <ToggleLeft className="mr-2 h-4 w-4" />
                        ) : (
                          <ToggleRight className="mr-2 h-4 w-4" />
                        )}
                        {j.isActive ? "Deactivate" : "Activate"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() =>
                          startTransition(async () => {
                            const res = await deleteJobCode(j.id);
                            if (!toastAction(res)) return;
                            toast.success("Deleted");
                          })
                        }
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                No job codes yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Edit dialog (controlled) — keyed so it remounts per row. */}
      {editing && (
        <JobCodeDialog
          key={editing.id}
          departments={departments}
          existing={editing}
          open
          onOpenChange={(o) => { if (!o) setEditing(null); }}
        />
      )}
    </>
  );
}
