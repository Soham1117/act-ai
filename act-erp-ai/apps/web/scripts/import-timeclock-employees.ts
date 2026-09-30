/**
 * Import the headerless TimeClock Plus employee export used in September 2026.
 *
 * Dry-run is the default. Pass --apply to write. The importer is idempotent:
 * existing employees are matched by export code, username, or normalized name,
 * and only missing profile fields are filled on a match. Existing passwords are
 * never reset.
 *
 * Usage:
 *   pnpm exec tsx scripts/import-timeclock-employees.ts /path/export.csv
 *   pnpm exec tsx scripts/import-timeclock-employees.ts /path/export.csv --apply
 */
import { readFile } from "node:fs/promises";
import { Prisma, PrismaClient, type Employee } from "@prisma/client";
import bcrypt from "bcryptjs";
import { combineAddressLines, generateEmployeeId } from "../src/lib/employee-create";
import { DEFAULT_KIOSK_PIN } from "../src/lib/kiosk-pin";

const db = new PrismaClient();

type SourceEmployee = {
  sourceNumber: string;
  fullName: string;
  firstName: string;
  lastName: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  exportCode: string | null;
  ssnLast4: string | null;
  phoneNumber: string | null;
  dateOfBirth: Date | null;
  dateOfHire: Date | null;
  gender: "MALE" | "FEMALE" | "OTHER";
  personalEmail: string | null;
  departmentName: string | null;
  username: string;
  temporaryPassword: string;
};

type ExistingEmployee = Employee & { user: { id: string; username: string | null } };

const DEPARTMENT_NAME_MAP: Record<string, string> = {
  ADMIN: "Management",
  "INSIDE SALES": "Sales",
  MANUFACTURING: "Manufacturing",
  ASSEMBLEY: "Assembly",
  WAREHOUSE: "Warehouse",
  "WELL SERVICES DIVISION": "Well Services Division",
  OPERATIONS: "Operations",
};

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (quoted) throw new Error("CSV ends inside a quoted field");
  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function nullable(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizedName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function usernamePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function assignUniqueUsernames(source: SourceEmployee[]): void {
  const groups = new Map<string, SourceEmployee[]>();
  for (const item of source) {
    groups.set(item.username, [...(groups.get(item.username) ?? []), item]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const used = new Map<string, number>();
    for (const item of group) {
      const first = usernamePart(item.firstName);
      const base = `${first.slice(0, 2)}${usernamePart(item.lastName)}`;
      const occurrence = (used.get(base) ?? 0) + 1;
      used.set(base, occurrence);
      item.username = occurrence === 1 ? base : `${base}${occurrence}`;
      item.temporaryPassword = `${item.username[0].toUpperCase()}${item.username.slice(1)}123!`;
    }
  }
}

function targetDepartmentName(sourceName: string | null): string | null {
  if (!sourceName) return null;
  return DEPARTMENT_NAME_MAP[sourceName.trim().toUpperCase()] ?? sourceName.trim();
}

function parseUsDate(value: string | undefined, label: string, rowNumber: number): Date | null {
  const text = value?.trim();
  if (!text) return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!match) throw new Error(`Row ${rowNumber}: invalid ${label} ${JSON.stringify(text)}`);
  const [, monthText, dayText, yearText] = match;
  const month = Number(monthText);
  const day = Number(dayText);
  const year = Number(yearText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Row ${rowNumber}: invalid ${label} ${JSON.stringify(text)}`);
  }
  return date;
}

function parseSourceRow(row: string[], rowNumber: number): SourceEmployee {
  if (row.length !== 83) throw new Error(`Row ${rowNumber}: expected 83 columns, got ${row.length}`);
  const sourceNumber = row[0].trim();
  const fullName = row[2].trim();
  const firstName = row[3].trim();
  const lastName = row[4].trim();
  if (!/^\d+$/.test(sourceNumber) || !fullName || !firstName || !lastName) {
    throw new Error(`Row ${rowNumber}: missing employee number or name`);
  }
  if (row[10].trim() !== "0") {
    throw new Error(`Row ${rowNumber}: suspended employees are not part of this import`);
  }
  const last = usernamePart(lastName);
  const initial = usernamePart(firstName).slice(0, 1);
  if (!initial || !last) throw new Error(`Row ${rowNumber}: cannot generate username`);
  const rawSsn = row[12].trim();
  if (rawSsn && !/^\d{1,4}$/.test(rawSsn)) {
    throw new Error(`Row ${rowNumber}: SSN value is not 1-4 digits`);
  }
  const email = nullable(row[17])?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`Row ${rowNumber}: invalid email address`);
  }
  const genderCode = row[16].trim().toUpperCase();
  const gender = genderCode === "M" ? "MALE" : genderCode === "F" ? "FEMALE" : "OTHER";
  return {
    sourceNumber,
    fullName,
    firstName,
    lastName,
    address: combineAddressLines(row[5], row[6]),
    city: nullable(row[7]),
    state: nullable(row[8])?.toUpperCase() ?? null,
    zipCode: nullable(row[9]),
    exportCode: nullable(row[11]),
    ssnLast4: rawSsn ? rawSsn.padStart(4, "0") : null,
    phoneNumber: nullable(row[13]),
    dateOfBirth: parseUsDate(row[14], "date of birth", rowNumber),
    dateOfHire: parseUsDate(row[15], "date of hire", rowNumber),
    gender,
    personalEmail: email,
    // The removed export columns make the later positions unsafe to infer.
    // Column 31 is identifiable as Department across all rows in this file.
    departmentName: nullable(row[31]),
    username: `${initial}${last}`,
    temporaryPassword: `${initial.toUpperCase()}${last}123!`,
  };
}

function missingProfileData(
  existing: ExistingEmployee,
  source: SourceEmployee,
  departmentId: string | null,
): Prisma.EmployeeUpdateInput {
  const data: Prisma.EmployeeUpdateInput = {};
  const fill = <K extends keyof Prisma.EmployeeUpdateInput>(
    key: K,
    current: unknown,
    value: Prisma.EmployeeUpdateInput[K] | null,
  ) => {
    if ((current === null || current === "") && value !== null) data[key] = value;
  };
  fill("address", existing.address, source.address);
  fill("city", existing.city, source.city);
  fill("state", existing.state, source.state);
  fill("zipCode", existing.zipCode, source.zipCode);
  fill("ssnLast4", existing.ssnLast4, source.ssnLast4);
  fill("phoneNumber", existing.phoneNumber, source.phoneNumber);
  fill("dateOfBirth", existing.dateOfBirth, source.dateOfBirth);
  fill("dateOfHire", existing.dateOfHire, source.dateOfHire);
  fill("personalEmail", existing.personalEmail, source.personalEmail);
  fill("exportCode", existing.exportCode, source.exportCode);
  if (!existing.departmentId && departmentId) data.department = { connect: { id: departmentId } };
  return data;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const filePath = args.find((arg) => !arg.startsWith("--"));
  if (!filePath) throw new Error("Pass the TimeClock CSV path");
  const rows = parseCsv(await readFile(filePath, "utf8"));
  const source = rows.map((row, index) => parseSourceRow(row, index + 1));
  assignUniqueUsernames(source);
  const sourceUsernameGroups = new Map<string, string[]>();
  for (const item of source) {
    sourceUsernameGroups.set(item.username, [
      ...(sourceUsernameGroups.get(item.username) ?? []),
      item.fullName,
    ]);
  }
  const sourceUsernameConflicts = [...sourceUsernameGroups.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([username, names]) => ({ username, names }));

  const [existingEmployees, departments] = await Promise.all([
    db.employee.findMany({
      include: { user: { select: { id: true, username: true } } },
    }),
    db.department.findMany({ select: { id: true, name: true } }),
  ]);
  const departmentByName = new Map(
    departments.map((department) => [normalizedName(department.name), department.id]),
  );
  const byExportCode = new Map(
    existingEmployees
      .filter((employee) => employee.exportCode)
      .map((employee) => [employee.exportCode!.toLowerCase(), employee]),
  );
  const byUsername = new Map(
    existingEmployees
      .filter((employee) => employee.user.username)
      .map((employee) => [employee.user.username!.toLowerCase(), employee]),
  );
  const byName = new Map(
    existingEmployees.map((employee) => [normalizedName(employee.name), employee]),
  );

  const planned = source.map((item) => {
    const existing =
      (item.exportCode ? byExportCode.get(item.exportCode.toLowerCase()) : undefined) ??
      byName.get(normalizedName(item.fullName));
    const departmentName = targetDepartmentName(item.departmentName);
    const departmentId = departmentName
      ? departmentByName.get(normalizedName(departmentName)) ?? null
      : null;
    const usernameOwner = byUsername.get(item.username);
    const conflict = usernameOwner && usernameOwner.id !== existing?.id ? usernameOwner : null;
    const update = existing ? missingProfileData(existing, item, departmentId) : {};
    const updateUsername = Boolean(
      existing && existing.user.username?.toLowerCase() !== item.username,
    );
    return {
      item,
      existing,
      departmentName,
      departmentId,
      conflict,
      update,
      updateUsername,
    };
  });

  const departmentsToCreate = [
    ...new Set(
      planned
        .filter((row) => row.departmentName && !row.departmentId)
        .map((row) => row.departmentName as string),
    ),
  ];

  const summary = {
    mode: apply ? "apply" : "dry-run",
    sourceRows: source.length,
    newEmployees: planned.filter((row) => !row.existing && !row.conflict).length,
    existingMatches: planned.filter((row) => row.existing).length,
    existingProfilesToEnrich: planned.filter((row) => Object.keys(row.update).length > 0).length,
    existingUsernamesToChange: planned
      .filter((row) => row.updateUsername)
      .map((row) => ({ name: row.item.fullName, username: row.item.username })),
    conflicts: planned.filter((row) => row.conflict).map((row) => row.item.fullName),
    sourceUsernameConflicts,
    departmentsToCreate,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!apply) return;
  if (summary.conflicts.length || summary.sourceUsernameConflicts.length) {
    throw new Error("Resolve username conflicts before applying");
  }

  if (departmentsToCreate.length) {
    await db.department.createMany({
      data: departmentsToCreate.map((name) => ({ name })),
      skipDuplicates: true,
    });
    const createdDepartments = await db.department.findMany({
      where: { name: { in: departmentsToCreate } },
      select: { id: true, name: true },
    });
    for (const department of createdDepartments) {
      departmentByName.set(normalizedName(department.name), department.id);
    }
    for (const row of planned) {
      row.departmentId = row.departmentName
        ? departmentByName.get(normalizedName(row.departmentName)) ?? null
        : null;
      if (row.existing) {
        row.update = missingProfileData(row.existing, row.item, row.departmentId);
      }
    }
  }

  const kioskPinHash = await bcrypt.hash(DEFAULT_KIOSK_PIN, 12);
  for (const row of planned) {
    if (row.existing) {
      if (row.updateUsername) {
        await db.user.update({
          where: { id: row.existing.user.id },
          data: { username: row.item.username },
        });
      }
      if (Object.keys(row.update).length) {
        await db.employee.update({ where: { id: row.existing.id }, data: row.update });
      }
      continue;
    }
    const passwordHash = await bcrypt.hash(row.item.temporaryPassword, 12);
    await db.$transaction(async (tx) => {
      const employeeId = await generateEmployeeId(tx);
      const user = await tx.user.create({
        data: {
          username: row.item.username,
          name: row.item.fullName,
          role: "EMPLOYEE",
          passwordHash,
          mustChangePassword: true,
        },
      });
      await tx.employee.create({
        data: {
          employeeId,
          userId: user.id,
          name: row.item.fullName,
          gender: row.item.gender,
          phoneNumber: row.item.phoneNumber,
          dateOfBirth: row.item.dateOfBirth,
          personalEmail: row.item.personalEmail,
          address: row.item.address,
          city: row.item.city,
          state: row.item.state,
          zipCode: row.item.zipCode,
          ssnLast4: row.item.ssnLast4,
          departmentId: row.departmentId,
          dateOfHire: row.item.dateOfHire,
          employmentType: "FULL_PART_TIME",
          employmentStatus: "ACTIVE",
          exportCode: row.item.exportCode,
          compensationType: "HOURLY_RATE",
          compensationValue: null,
          kioskPinHash,
        },
      });
    });
  }
  console.log("Import complete.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
