import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { businessDateOnly } from "@/lib/format";
import {
  computeBalances,
  type BalanceInput,
  type LeavePolicyValues,
  type PolicyMap,
  type YearBalances,
} from "@/lib/leave-balance";

type Client = Prisma.TransactionClient;

export async function loadPolicies(client: Client = db): Promise<PolicyMap> {
  const rows = await client.leavePolicy.findMany();
  const map: PolicyMap = {};
  for (const r of rows) {
    const v: LeavePolicyValues = {
      daysPerYear: Number(r.daysPerYear),
      unlimited: r.unlimited,
      accrualMode: r.accrualMode,
      carryoverMax: Number(r.carryoverMax),
    };
    map[r.leaveType] = v;
  }
  return map; // missing types fall back to DEFAULT_LEAVE_POLICIES
}

/**
 * Load everything needed to compute balances for many employees at once.
 * Fetches requests/adjustments from (minYear - 1) so one-year-back carryover
 * is exact.
 */
export async function loadBalanceInputs(
  employeeIds: string[],
  years: number[],
  client: Client = db,
): Promise<Map<string, BalanceInput>> {
  const out = new Map<string, BalanceInput>();
  if (employeeIds.length === 0) return out;
  const minYear = Math.min(...years) - 1;
  const maxYear = Math.max(...years);
  const from = new Date(Date.UTC(minYear, 0, 1));
  const to = new Date(Date.UTC(maxYear, 11, 31));
  const today = businessDateOnly();

  const [policies, employees, requests, adjustments] = await Promise.all([
    loadPolicies(client),
    client.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, dateOfHire: true },
    }),
    client.leaveRequest.findMany({
      where: {
        employeeId: { in: employeeIds },
        status: { in: ["PENDING", "APPROVED"] },
        startDate: { lte: to },
        endDate: { gte: from },
      },
      select: {
        employeeId: true, leaveType: true, startDate: true, endDate: true,
        startHalfDay: true, endHalfDay: true, status: true,
      },
    }),
    client.leaveAdjustment.findMany({
      where: { employeeId: { in: employeeIds }, year: { gte: minYear, lte: maxYear } },
      select: { employeeId: true, year: true, leaveType: true, days: true },
    }),
  ]);

  for (const e of employees) {
    out.set(e.id, {
      policies,
      hireDate: e.dateOfHire,
      today,
      adjustments: adjustments
        .filter((a) => a.employeeId === e.id)
        .map((a) => ({ year: a.year, leaveType: a.leaveType, days: Number(a.days) })),
      requests: requests.filter((r) => r.employeeId === e.id),
    });
  }
  return out;
}

export async function loadBalanceInput(
  employeeId: string,
  years: number[],
  client: Client = db,
): Promise<BalanceInput | null> {
  return (await loadBalanceInputs([employeeId], years, client)).get(employeeId) ?? null;
}

/** Current business year (Central). */
export function currentLeaveYear(): number {
  return businessDateOnly().getUTCFullYear();
}

/** Balances for one employee for a year (defaults to the current year). */
export async function loadLeaveBalances(
  employeeId: string,
  year: number = currentLeaveYear(),
  client: Client = db,
): Promise<YearBalances | null> {
  const input = await loadBalanceInput(employeeId, [year], client);
  return input ? computeBalances(input, year) : null;
}

/** Balances for many employees (admin table). */
export async function loadLeaveBalancesFor(
  employeeIds: string[],
  year: number = currentLeaveYear(),
  client: Client = db,
): Promise<Map<string, YearBalances>> {
  const inputs = await loadBalanceInputs(employeeIds, [year], client);
  const out = new Map<string, YearBalances>();
  for (const [id, input] of inputs) out.set(id, computeBalances(input, year));
  return out;
}
