import type { SeedContext } from "../seed";
import { CODES, CUSTOM_PIN, DEFAULT_PIN, DEPTS, PEOPLE, PEOPLE_PASSWORD } from "../support/people-data";

/**
 * Data for the admin people-management specs (employees, onboarding, hire
 * packets, departments, job codes). Every ACTIVE person here also gets one
 * approved shift in the seeded "E2E Pay Period", because payroll readiness
 * blocks when any active employee has no hours (payroll-csv.spec.ts).
 */
export default async function seedPeople(ctx: SeedContext) {
  const { db, daysAgo, at, makeEmployee } = ctx;

  const staffed = await db.department.create({
    data: { ...DEPTS.staffed, description: "Seeded department with a member" },
  });
  await db.department.create({ data: { ...DEPTS.empty, description: "Seeded empty department" } });
  await db.department.create({ data: { ...DEPTS.invite } });

  for (const c of Object.values(CODES)) {
    await db.jobCode.create({ data: { ...c, rate: "NA", isActive: true, isDefault: false } });
  }

  const hours = (employeeId: string) =>
    db.timeEntry.create({
      data: {
        employeeId,
        date: daysAgo(55),
        clockIn: at(daysAgo(55), 14),
        clockOut: at(daysAgo(55), 22),
        totalWorkMin: 480,
        status: "APPROVED",
        jobCode: "E2E100",
        source: "MANUAL",
        approvalStatus: "APPROVED",
        approvalDate: new Date(),
      },
    });

  const make = async (
    key: keyof typeof PEOPLE,
    opts: {
      pin?: string | null;
      status?: "ACTIVE" | "TERMINATED";
      hours?: boolean;
      departmentId?: string;
    } = {},
  ) => {
    const p = PEOPLE[key];
    const emp = await makeEmployee({
      employeeId: p.employeeId,
      name: p.name,
      email: p.email,
      password: PEOPLE_PASSWORD,
      pin: opts.pin === undefined ? DEFAULT_PIN : opts.pin,
      status: opts.status,
      terminationDate: opts.status === "TERMINATED" ? daysAgo(10) : undefined,
    });
    if (opts.departmentId) {
      await db.employee.update({ where: { id: emp.id }, data: { departmentId: opts.departmentId } });
    }
    if (opts.hours !== false && opts.status !== "TERMINATED") await hours(emp.id);
    return emp;
  };

  await make("edith");
  await make("terry");
  await make("bulkA");
  await make("bulkB");
  await make("bulkC", { status: "TERMINATED", hours: false });
  await make("bulkD");
  await make("paula");
  await make("pinn", { pin: CUSTOM_PIN });
  await make("pico");
  await make("supa");
  await make("supb");
  await make("rory");
  const pend1 = await make("pend1", { hours: false });
  const pend2 = await make("pend2", { hours: false });
  await db.employee.updateMany({
    where: { id: { in: [pend1.id, pend2.id] } },
    data: { employmentStatus: "PENDING_REVIEW" },
  });
  // jcA / jcB have a real PIN so they can punch at the kiosk in the job-code specs.
  await make("jcA", { pin: CUSTOM_PIN });
  await make("jcB", { pin: CUSTOM_PIN });
  await make("hp1");
  await make("hp2");
  await make("dept", { departmentId: staffed.id });
  const onleave = await make("onleave", { hours: false });
  await db.employee.update({ where: { id: onleave.id }, data: { employmentStatus: "ON_LEAVE" } });
}
