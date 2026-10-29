import { assertLegacyEmployeeScriptSafe } from "../src/lib/employee-script-guard";
/**
 * Align Persona roster to paystub legal names, then create anyone present on
 * paystubs or TimeClock Plus who is missing from Persona.
 *
 * Dry-run default. Pass --apply to write.
 *
 *   pnpm exec tsx scripts/sync-paystub-tcp-roster.ts \
 *     --paystubs "/path/Paystubs 10-29-2026.pdf" \
 *     --tcp "/path/tcp-people.json" \
 *     [--apply]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { analyzePaystubPdf, type ParsedPaystub } from "../src/lib/paystub-parser";
import { matchEmployee } from "../src/lib/paystub-match";
import { combineAddressLines, generateEmployeeId } from "../src/lib/employee-create";
import { DEFAULT_KIOSK_PIN } from "../src/lib/kiosk-pin";

const db = new PrismaClient();

type TcpPerson = {
  name: string;
  location?: string;
  address?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  hire?: string;
};

type StubPerson = { name: string; ssnLast4: string | null; page: number };

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

function titleCaseName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Mc)([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

function normalizedKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

function parseUsDate(value: string | undefined): Date | null {
  const text = value?.trim();
  if (!text) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function usernameFromName(name: string): string {
  const parts = name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((p) => p.length > 1);
  const first = parts[0] ?? "user";
  const last = parts[parts.length - 1] ?? "x";
  return `${first[0]}${last}`.slice(0, 32);
}

function uniqueUsername(base: string, taken: Set<string>): string {
  let candidate = base;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${base}${n}`.slice(0, 32);
    n += 1;
  }
  taken.add(candidate);
  return candidate;
}

async function loadStubs(pdfPath: string): Promise<StubPerson[]> {
  const bytes = readFileSync(pdfPath);
  const analysis = await analyzePaystubPdf(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const byKey = new Map<string, StubPerson>();
  for (const page of analysis.pages) {
    const name = page.parsed?.employeeName?.trim();
    if (!name) continue;
    const ssn = page.parsed?.ssnLast4 ?? null;
    const key = `${normalizedKey(name)}|${ssn ?? ""}`;
    if (!byKey.has(key)) {
      byKey.set(key, { name: titleCaseName(name), ssnLast4: ssn, page: page.pageNumber });
    }
  }
  return [...byKey.values()];
}

async function main() {
  await assertLegacyEmployeeScriptSafe(db);
  const apply = process.argv.includes("--apply");
  const paystubsPath = arg("--paystubs");
  const tcpPath = arg("--tcp");
  if (!paystubsPath) throw new Error("Pass --paystubs /path/to.pdf");
  if (!tcpPath) throw new Error("Pass --tcp /path/to/tcp-people.json");

  const stubs = await loadStubs(resolve(paystubsPath));
  const tcpPeople = JSON.parse(readFileSync(resolve(tcpPath), "utf8")) as TcpPerson[];

  const employees = await db.employee.findMany({
    include: { user: { select: { id: true, username: true, name: true } } },
  });
  const roster = employees.map((e) => ({
    id: e.id,
    name: e.name,
    ssnLast4: e.ssnLast4,
  }));

  const renames: Array<{
    employeeId: string;
    id: string;
    userId: string;
    from: string;
    to: string;
    ssnLast4: string | null;
  }> = [];
  const stubCreates: StubPerson[] = [];
  const matchedEmployeeIds = new Set<string>();

  for (const stub of stubs) {
    const parsed: ParsedPaystub = {
      employeeName: stub.name,
      ssnLast4: stub.ssnLast4,
      payPeriodStart: null,
      payPeriodEnd: null,
      payDate: null,
      checkNumber: null,
      netPay: null,
    };
    let match = matchEmployee(parsed, roster);

    // Extra aliases: Gonzales/Gonzalez, Alexandro/Alex, Ronald/Ron, Kenneth/Ken, Pillai/Somarajan
    if (!match.employeeId || !match.nameOk) {
      const aliasHits = employees.filter((e) => {
        const a = normalizedKey(e.name);
        const b = normalizedKey(stub.name);
        if (a === b) return true;
        if (stub.ssnLast4 && e.ssnLast4 === stub.ssnLast4) return true;
        // token containment for shortened legal names
        const aw = a;
        const bw = b;
        return (
          (aw.includes("gonzalez") && bw.includes("gonzales")) ||
          (aw.includes("gonzales") && bw.includes("gonzalez")) ||
          (aw.includes("alextorres") && bw.includes("alejandrot")) ||
          (aw.includes("alextorres") && bw.includes("alexandro")) ||
          (aw.includes("alexandro") && bw.includes("alextorres")) ||
          (aw.includes("ronschmidt") && bw.includes("ronald")) ||
          (aw.includes("ronald") && bw.includes("ronschmidt")) ||
          (aw.includes("kenstokley") && bw.includes("kenneth")) ||
          (aw.includes("kenneth") && bw.includes("kenstokley")) ||
          (aw.includes("deepaksomarajan") && bw.includes("deepak") && bw.includes("pillai")) ||
          (bw.includes("deepaksomarajan") && aw.includes("deepak") && aw.includes("pillai")) ||
          (aw.includes("deeanna") && bw.includes("deeanna")) ||
          (aw.includes("tapansinha") && bw.includes("tapansinha"))
        );
      });
      if (aliasHits.length === 1) {
        match = {
          employeeId: aliasHits[0].id,
          confidence: "medium",
          reason: "alias",
          nameOk: true,
          ssnOk: Boolean(stub.ssnLast4 && aliasHits[0].ssnLast4 === stub.ssnLast4),
        };
      }
    }

    if (match.employeeId && (match.nameOk || match.ssnOk || match.confidence !== "none")) {
      const emp = employees.find((e) => e.id === match.employeeId)!;
      matchedEmployeeIds.add(emp.id);
      if (emp.name.trim() !== stub.name) {
        renames.push({
          employeeId: emp.employeeId,
          id: emp.id,
          userId: emp.userId,
          from: emp.name,
          to: stub.name,
          ssnLast4: stub.ssnLast4,
        });
      }
      // Fill missing SSN last4 from stub when safe
      continue;
    }
    stubCreates.push(stub);
  }

  // Catch paystub people who only failed match due to SSN drift (e.g. Tapan).
  const remainingStubCreates: StubPerson[] = [];
  for (const stub of stubCreates) {
    const words = stub.name
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1);
    const first = words[0];
    const last = words[words.length - 1];
    const hits = employees.filter((e) => {
      if (matchedEmployeeIds.has(e.id)) return false;
      const key = normalizedKey(e.name);
      return Boolean(first && last && key.includes(first) && key.includes(last));
    });
    if (hits.length === 1) {
      const emp = hits[0];
      matchedEmployeeIds.add(emp.id);
      if (emp.name.trim() !== stub.name) {
        renames.push({
          employeeId: emp.employeeId,
          id: emp.id,
          userId: emp.userId,
          from: emp.name,
          to: stub.name,
          ssnLast4: stub.ssnLast4,
        });
      }
      continue;
    }
    remainingStubCreates.push(stub);
  }
  stubCreates.length = 0;
  stubCreates.push(...remainingStubCreates);

  // TCP people not already represented (after planned renames / stub creates)
  const personaNameKeys = new Set<string>();
  for (const e of employees) {
    personaNameKeys.add(normalizedKey(e.name));
    const renamed = renames.find((r) => r.id === e.id);
    if (renamed) {
      personaNameKeys.add(normalizedKey(renamed.from));
      personaNameKeys.add(normalizedKey(renamed.to));
    }
  }
  for (const stub of stubs) personaNameKeys.add(normalizedKey(stub.name));
  for (const stub of stubCreates) personaNameKeys.add(normalizedKey(stub.name));

  function firstLast(name: string): { first: string; last: string } | null {
    const words = name
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1);
    if (words.length < 2) return null;
    return { first: words[0]!, last: words[words.length - 1]! };
  }

  function coveredByPersona(name: string): boolean {
    const key = normalizedKey(name);
    if (personaNameKeys.has(key)) return true;
    const fl = firstLast(name);
    if (!fl) return false;
    for (const existing of personaNameKeys) {
      // Require same first+last anchors — avoids Jose covering Jamie Gonzales.
      if (existing.startsWith(fl.first) && existing.endsWith(fl.last)) return true;
    }
    const aliases: Array<[RegExp, RegExp]> = [
      [/^jose.*gonzal[ae]z$/, /^jose.*gonzal[ae]z$/],
      [/^alex(?:andro)?torres$/, /^alex(?:andro)?torres$/],
      [/^deepak.*(?:somarajan|pillai)$/, /^deepak.*(?:somarajan|pillai)$/],
      [/^ron(?:ald)?.*schmidt$/, /^ron(?:ald)?.*schmidt$/],
      [/^ken(?:neth)?.*stokley$/, /^ken(?:neth)?.*stokley$/],
    ];
    for (const existing of personaNameKeys) {
      for (const [a, b] of aliases) {
        if ((a.test(key) && b.test(existing)) || (b.test(key) && a.test(existing))) return true;
      }
    }
    return false;
  }

  const tcpCreates: TcpPerson[] = [];
  for (const person of tcpPeople) {
    if (!person.name?.trim()) continue;
    if (coveredByPersona(person.name)) continue;
    tcpCreates.push(person);
    personaNameKeys.add(normalizedKey(person.name));
  }

  const plan = {
    mode: apply ? "apply" : "dry-run",
    stubPeople: stubs.length,
    renames,
    stubCreates,
    tcpCreates,
    ssnBackfills: stubs
      .map((stub) => {
        const rename = renames.find((r) => normalizedKey(r.to) === normalizedKey(stub.name));
        const emp =
          employees.find((e) => e.id === rename?.id) ??
          employees.find((e) => normalizedKey(e.name) === normalizedKey(stub.name));
        if (!emp || !stub.ssnLast4) return null;
        if (emp.ssnLast4 === stub.ssnLast4) return null;
        if (emp.ssnLast4 && emp.ssnLast4 !== stub.ssnLast4) return null;
        return { id: emp.id, employeeId: emp.employeeId, name: stub.name, ssnLast4: stub.ssnLast4 };
      })
      .filter(Boolean),
  };

  const outPath = resolve("roster-sync-plan.json");
  writeFileSync(outPath, JSON.stringify(plan, null, 2));
  console.log(
    JSON.stringify(
      {
        mode: plan.mode,
        stubPeople: plan.stubPeople,
        renameCount: renames.length,
        stubCreateCount: stubCreates.length,
        tcpCreateCount: tcpCreates.length,
        ssnBackfillCount: plan.ssnBackfills.length,
        renames,
        stubCreates: stubCreates.map((s) => ({ name: s.name, ssnLast4: s.ssnLast4 })),
        tcpCreates: tcpCreates.map((p) => ({ name: p.name, location: p.location, hire: p.hire })),
      },
      null,
      2,
    ),
  );

  if (!apply) return;

  // Include every User row — admins / orphans collide on username too.
  const allUsers = await db.user.findMany({ select: { username: true } });
  const takenUsernames = new Set(
    allUsers.map((u) => u.username?.toLowerCase()).filter(Boolean) as string[],
  );
  const kioskPinHash = await bcrypt.hash(DEFAULT_KIOSK_PIN, 12);

  let renamed = 0;
  let stubCreated = 0;
  let tcpCreated = 0;

  for (const row of renames) {
    const current = await db.employee.findUniqueOrThrow({ where: { id: row.id } });
    if (current.name === row.to && (!row.ssnLast4 || current.ssnLast4)) {
      continue;
    }
    await db.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id: row.id },
        data: {
          name: row.to,
          ...(row.ssnLast4 && !current.ssnLast4 ? { ssnLast4: row.ssnLast4 } : {}),
        },
      });
      await tx.user.update({ where: { id: row.userId }, data: { name: row.to } });
      await tx.auditLog.create({
        data: {
          actorEmail: "system@roster-sync",
          action: "employee.name.paystub_sync",
          resource: `Employee:${row.id}`,
          diff: { employeeId: row.employeeId, from: row.from, to: row.to, source: "paystub" },
        },
      });
    });
    renamed += 1;
  }

  for (const stub of stubCreates) {
    const exists = await db.employee.findFirst({
      where: { name: { equals: stub.name, mode: "insensitive" } },
    });
    if (exists) continue;
    const username = uniqueUsername(usernameFromName(stub.name), takenUsernames);
    const passwordHash = await bcrypt.hash(`${username[0]!.toUpperCase()}${username.slice(1)}123!`, 12);
    await db.$transaction(async (tx) => {
      const employeeId = await generateEmployeeId(tx);
      const user = await tx.user.create({
        data: {
          username,
          name: stub.name,
          role: "EMPLOYEE",
          passwordHash,
          mustChangePassword: true,
        },
      });
      const emp = await tx.employee.create({
        data: {
          employeeId,
          userId: user.id,
          name: stub.name,
          gender: "OTHER",
          ssnLast4: stub.ssnLast4,
          employmentType: "FULL_PART_TIME",
          employmentStatus: "ACTIVE",
          compensationType: "HOURLY_RATE",
          kioskPinHash,
        },
      });
      await tx.auditLog.create({
        data: {
          actorEmail: "system@roster-sync",
          action: "employee.create.paystub_sync",
          resource: `Employee:${emp.id}`,
          diff: {
            employeeId,
            name: stub.name,
            ssnLast4: stub.ssnLast4,
            username,
            source: "paystub",
          },
        },
      });
    });
    stubCreated += 1;
  }

  for (const person of tcpCreates) {
    const exists = await db.employee.findFirst({
      where: { name: { equals: person.name, mode: "insensitive" } },
    });
    if (exists) continue;
    const username = uniqueUsername(usernameFromName(person.name), takenUsernames);
    const passwordHash = await bcrypt.hash(`${username[0]!.toUpperCase()}${username.slice(1)}123!`, 12);
    const address = combineAddressLines(person.address, person.address2);
    const dateOfHire = parseUsDate(person.hire);
    await db.$transaction(async (tx) => {
      const employeeId = await generateEmployeeId(tx);
      const user = await tx.user.create({
        data: {
          username,
          name: person.name,
          role: "EMPLOYEE",
          passwordHash,
          mustChangePassword: true,
        },
      });
      const emp = await tx.employee.create({
        data: {
          employeeId,
          userId: user.id,
          name: person.name,
          gender: "OTHER",
          address,
          city: person.city?.trim() || null,
          state: person.state?.trim()?.toUpperCase() || null,
          zipCode: person.zip?.trim() || null,
          dateOfHire,
          employmentType: "FULL_PART_TIME",
          employmentStatus: "ACTIVE",
          compensationType: "HOURLY_RATE",
          kioskPinHash,
          jobTitle: person.location?.trim() || null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorEmail: "system@roster-sync",
          action: "employee.create.tcp_sync",
          resource: `Employee:${emp.id}`,
          diff: {
            employeeId,
            name: person.name,
            location: person.location,
            username,
            source: "tcp",
          },
        },
      });
    });
    tcpCreated += 1;
  }

  console.log(
    JSON.stringify({ applyResult: { renamed, stubCreated, tcpCreated } }),
  );
  console.log("Roster sync complete.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
