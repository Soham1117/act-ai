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
import { ArrowUpDown, MoreHorizontal, Search } from "lucide-react";
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
import { PanelSlot } from "@/components/inline-panel";
import { BulkActions } from "./bulk-actions";
import { DataListCard, FilterStack, ResponsiveDataList } from "@/components/mobile";

export type Row = {
  id: string;
  employeeId: string;
  name: string;
  email: string | null;
  jobTitle: string | null;
  departmentName: string | null;
  employmentType: "FULL_PART_TIME" | "CONTRACT_HOURLY";
  employmentStatus: "ACTIVE" | "ON_LEAVE" | "TERMINATED" | "PENDING_REVIEW" | "INACTIVE";
  /** Admin accounts can't be bulk-selected (server also refuses). */
  isAdmin: boolean;
  dateOfHire: string | null;
  profilePic: string | null;
};

export function EmployeesTable({ rows, actions }: { rows: Row[]; actions?: React.ReactNode }) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [rowSelection, setRowSelection] = React.useState({});
  const [showInactive, setShowInactive] = React.useState(false);

  // Row ids (not array indexes) key the selection, and it resets whenever the
  // visible set changes, so a hidden/filtered-out row can never be acted on.
  React.useEffect(() => {
    setRowSelection({});
  }, [showInactive, globalFilter]);

  const visibleRows = React.useMemo(
    () => (showInactive ? rows : rows.filter((r) => r.employmentStatus !== "TERMINATED" && r.employmentStatus !== "INACTIVE")),
    [rows, showInactive],
  );
  const inactiveCount = React.useMemo(
    () => rows.filter((r) => r.employmentStatus === "TERMINATED" || r.employmentStatus === "INACTIVE").length,
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
            disabled={row.original.isAdmin}
            title={row.original.isAdmin ? "Admin accounts can't be bulk-selected" : undefined}
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
            v === "ACTIVE"
              ? "success"
              : v === "INACTIVE"
                ? "secondary"
              : v === "ON_LEAVE" || v === "PENDING_REVIEW"
                ? "warning"
                : "destructive";
          return <Badge variant={variant}>{v.replace(/_/g, " ")}</Badge>;
        },
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{(getValue() as string | null) ?? "—"}</span>
        ),
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-11 w-11 md:h-8 md:w-8">
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
    getRowId: (r) => r.id,
    enableRowSelection: (row) => !row.original.isAdmin,
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

  // Selected AND currently visible (passes the search filter + inactive toggle).
  const selected = table
    .getFilteredRowModel()
    .rows.filter((r) => r.getIsSelected() && !r.original.isAdmin)
    .map((r) => ({ id: r.original.id, name: r.original.name }));

  const pageRows = table.getRowModel().rows;

  return (
    <div className="space-y-3">
      <FilterStack className="[&>div]:min-w-0">
        {actions && (
          <div className="shrink-0 [&_button]:min-h-11 sm:[&_button]:min-h-9">
            {actions}
          </div>
        )}
        <div className="relative w-full sm:w-auto sm:min-w-48 sm:flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            aria-label="Search employees"
            placeholder="Search name, email, ID…"
            value={globalFilter ?? ""}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="h-11 pl-8 sm:h-9"
          />
        </div>
        {selected.length > 0 && (
          <BulkActions selected={selected} onDone={() => setRowSelection({})} />
        )}
        <div className="flex w-full flex-wrap items-center justify-between gap-3 sm:ml-auto sm:w-auto">
          <div className="flex flex-wrap items-center gap-2">
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
      </FilterStack>
      <PanelSlot id="add-employee" />

      <ResponsiveDataList
        mobile={
          <div className="space-y-2">
            {pageRows.length ? (
              pageRows.map((row) => {
                const r = row.original;
                const src = r.profilePic ?? getAvatarUrl(r.email);
                return (
                  <DataListCard key={r.id} className="flex items-start gap-3">
                    {!r.isAdmin && (
                      <Checkbox
                        checked={row.getIsSelected()}
                        onCheckedChange={(v) => row.toggleSelected(!!v)}
                        aria-label={`Select ${r.name}`}
                        className="mt-1"
                      />
                    )}
                    <Link href={`/admin/employees/${r.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted">
                        <Image src={src} alt={r.name} fill sizes="40px" className="object-cover" unoptimized />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{r.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {r.employeeId}
                          {r.jobTitle ? ` · ${r.jobTitle}` : ""}
                        </span>
                        <span className="mt-1 inline-flex">
                          <Badge
                            variant={
                              r.employmentStatus === "ACTIVE"
                                ? "success"
                                : r.employmentStatus === "TERMINATED"
                                  ? "destructive"
                                  : "secondary"
                            }
                            className="text-[10px]"
                          >
                            {r.employmentStatus.replace(/_/g, " ")}
                          </Badge>
                        </span>
                      </span>
                    </Link>
                  </DataListCard>
                );
              })
            ) : (
              <p className="rounded-md border p-8 text-center text-sm text-muted-foreground">
                No employees match your filter.
              </p>
            )}
          </div>
        }
        desktop={
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
                {pageRows.length ? (
                  pageRows.map((row) => (
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
        }
      />

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="min-h-10 sm:min-h-0" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            Previous
          </Button>
          <Button variant="outline" size="sm" className="min-h-10 sm:min-h-0" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
