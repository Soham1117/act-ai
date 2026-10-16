import type { SeedContext } from "../seed";
import {
  DEPT_A,
  DEPT_B,
  JOB_CODE_2,
  LENA,
  OLIVE,
  OLIVE_SHIFT,
  SAM,
  SCHED_PASSWORD,
  STAN,
  TARA,
  TERRY,
  UMA,
  WES,
  WES_SHIFTS,
  dateOnly,
} from "../support/schedules";

/** Schedules area: departments, people, a second job code and fixed read-only shifts. */
export default async function (ctx: SeedContext) {
  const { db, makeEmployee, daysAgo } = ctx;

  const deptA = await db.department.create({ data: { name: DEPT_A } });
  const deptB = await db.department.create({ data: { name: DEPT_B } });
  await db.jobCode.create({
    data: { ...JOB_CODE_2, rate: "NA", isActive: true, isDefault: false },
  });

  const person = async (
    p: { employeeId: string; name: string; email: string },
    departmentId: string | null,
    extra: { status?: "ACTIVE" | "TERMINATED"; terminationDate?: Date } = {},
  ) => {
    const emp = await makeEmployee({ ...p, password: SCHED_PASSWORD, pin: null, ...extra });
    if (departmentId) await db.employee.update({ where: { id: emp.id }, data: { departmentId } });
    return emp;
  };

  await person(SAM, deptA.id);
  await person(TARA, deptA.id);
  await person(UMA, deptB.id);
  const wes = await person(WES, deptA.id);
  const olive = await person(OLIVE, deptB.id);
  // Terminated recently: still listed in the DB, but not schedulable.
  await person(TERRY, deptA.id, { status: "TERMINATED", terminationDate: daysAgo(10) });
  await person(LENA, deptB.id);
  await person(STAN, deptB.id);

  // Fixed shifts for the My schedule time checks (read-only in every spec).
  for (const s of Object.values(WES_SHIFTS)) {
    await db.schedule.create({
      data: {
        employeeId: wes.id,
        date: dateOnly(s.date),
        startTime: s.start,
        endTime: s.end,
        jobCode: s.code,
        notes: "notes" in s ? s.notes : null,
      },
    });
  }
  // Someone else's shift on the same day as Wes's first one.
  await db.schedule.create({
    data: {
      employeeId: olive.id,
      date: dateOnly(OLIVE_SHIFT.date),
      startTime: OLIVE_SHIFT.start,
      endTime: OLIVE_SHIFT.end,
      jobCode: OLIVE_SHIFT.code,
      notes: "Olive private note",
    },
  });
}
