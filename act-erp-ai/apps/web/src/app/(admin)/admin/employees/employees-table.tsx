"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown, MoreHorizontal, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { getAvatarUrl } from "@/lib/format";
import { getDepartmentConfig } from "@/lib/departments";
import { bulkDeleteEmployees } from "@/server/actions/employees";
import { toast } from "sonner";
import { useTransition } from "react";

export type Row = {
  id: string;
  employeeId: string;
  name: string;
  email: string | null;
  jobTitle: string | null;
  departmentName: string | null;
  employmentType: "FULL_PART_TIME" | "CONTRACT_HOURLY";
  employmentStatus: "ACTIVE" | "ON_LEAVE" | "TERMINATED";
  dateOfHire: string | null;
  profilePic: string | null;
};

export function EmployeesTable({ rows }: { rows: Row[] }) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [rowSelection, setRowSelection] = React.useState({});
  const [showInactive, setShowInactive] = React.useState(false);
  const [pending, startTransition] = useTransition();

  const visibleRows = React.useMemo(
    () => (showInactive ? rows : rows.filter((r) => r.employmentStatus !== "TERMINATED")),
    [rows, showInactive],
  );
  const inactiveCount = React.useMemo(
    () => rows.filter((r) => r.employmentStatus === "TERMINATED").length,
    [rows],
  );

  const columns = React.useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() ? "indeterminate" : false)
            }
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
            aria-label="Select row"
          />
        ),
        enableSorting: false,
      },
      {
        accessorKey: "name",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Name <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const r = row.original;
          const src = r.profilePic ?? getAvatarUrl(r.email);
          return (
            <Link
              href={`/admin/employees/${r.id}`}
              className="flex items-center gap-3 hover:underline"
            >
              <span className="relative h-8 w-8 overflow-hidden rounded-full bg-muted">
                <Image src={src} alt={r.name} fill sizes="32px" className="object-cover" unoptimized />
              </span>
              <span>
                <span className="block font-medium">{r.name}</span>
                <span className="block text-[11px] text-muted-foreground">{r.employeeId}</span>
              </span>
            </Link>
          );
        },
      },
      {
        accessorKey: "departmentName",
        header: "Department",
        cell: ({ getValue }) => {
          const v = getValue() as string | null;
          if (!v) return <span className="text-muted-foreground">—</span>;
          const cfg = getDepartmentConfig(v);
          const Icon = cfg.icon;
          return (
            <span className="inline-flex items-center gap-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded ${cfg.bgColor} ${cfg.color}`}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span>{cfg.label}</span>
            </span>
          );
        },
      },
      {
        accessorKey: "jobTitle",
        header: "Job title",
        cell: ({ getValue }) => (getValue() as string | null) ?? "—",
      },
      {
        accessorKey: "employmentType",
        header: "Type",
        cell: ({ getValue }) => {
          const v = getValue() as Row["employmentType"];
          return (
            <Badge variant="outline" className="font-normal">
              {v === "FULL_PART_TIME" ? "FT/PT" : "Contract"}
            </Badge>
          );
        },
      },
      {
        accessorKey: "employmentStatus",
        header: "Status",
        cell: ({ getValue }) => {
          const v = getValue() as Row["employmentStatus"];
          const variant =
            v === "ACTIVE" ? "success" : v === "ON_LEAVE" ? "warning" : "destructive";
          return <Badge variant={variant}>{v.replace("_", " ")}</Badge>;
        },
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{getValue() as string}</span>
        ),
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/admin/employees/${row.original.id}`}>View</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: visibleRows,
    columns,
    state: { sorting, globalFilter, rowSelection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  const selectedIds = table.getSelectedRowModel().rows.map((r) => r.original.id);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search name, email, ID…"
            value={globalFilter ?? ""}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        {selectedIds.length > 0 && (
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  const n = await bulkDeleteEmployees(selectedIds);
                  toast.success(`Deleted ${n} employee${n === 1 ? "" : "s"}`);
                  setRowSelection({});
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                }
              })
            }
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Delete {selectedIds.length}
          </Button>
        )}
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="show-inactive"
              checked={showInactive}
              onCheckedChange={setShowInactive}
            />
            <Label htmlFor="show-inactive" className="cursor-pointer text-xs text-muted-foreground">
              Show inactive ({inactiveCount})
            </Label>
          </div>
          <span className="text-xs text-muted-foreground">
            {table.getFilteredRowModel().rows.length} of {visibleRows.length}
          </span>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>
                    {h.isPlaceholder
                      ? null
                      : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center text-sm text-muted-foreground">
                  No employees match your filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            Previous
          </Button>
          <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
