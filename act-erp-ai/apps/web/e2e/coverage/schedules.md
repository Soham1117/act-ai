# Schedules coverage

| Item | Scenario | Status | Spec |
|---|---|---|---|
| `createSchedule` | happy path (row, notification, audit, calendar event) | covered | schedules-create.spec.ts "happy path" |
| `createSchedule` | overnight, end-before-start, same start/end, cleared time | covered | schedules-create.spec.ts |
| `createSchedule` | overlap (same employee, inside, adjacent allowed, previous-day overnight, next-day) | covered | schedules-create.spec.ts "overlap rules" |
| `createSchedule` | past date allowed | covered | schedules-create.spec.ts |
| `createSchedule` | leave-overlap warning toast | covered | schedules-create.spec.ts "leave overlap warning" |
| `createSchedule` | inactive / deleted employee, inactive / deleted job code, notes > 2000 | covered | schedules-create.spec.ts "server-side checks" |
| `createSchedule` | invalid date string, empty employee id | not-testable | the date picker and employee list cannot produce them |
| `createSchedule` | server failure, 500, stale deployment, double click | covered | schedules-create.spec.ts "failure injection" |
| `createSchedulesBulk` | multi-employee, date range + weekday picker | covered | schedules-create.spec.ts |
| `createSchedulesBulk` | partial skip message, all skipped | covered | schedules-create.spec.ts |
| `createSchedulesBulk` | >1500 shifts, >366 dates, inactive/deleted employee, job code, leave warning | covered | schedules-create.spec.ts |
| `createSchedulesBulk` | >200 employees | not-testable | fewer than 200 employees can be picked in the seed |
| `createSchedulesBulk` | server failure, double click | covered | schedules-create.spec.ts |
| `updateSchedule` | edit date/time/code/notes, delete, overlap, legacy codes, terminated employee, failures | covered | schedules-edit.spec.ts |
| `deleteSchedule` | confirm dialog, already deleted, failure, double click | covered | schedules-edit.spec.ts "admin deletes a shift" |
| `getScheduleEvents` | month navigation, correct local times, department/employee filter | covered | schedules-edit.spec.ts "admin calendar" |
| `getMyScheduleEvents` | Central times, DST, only own shifts, details popup | covered | my-schedule.spec.ts (spring-forward gap is test.fixme) |
| ScheduleTemplate model | no UI or action exists | not-testable | feature not built |
| `/dashboard/team` | does not show schedules | not-testable | no schedule content |
| Routes | `/admin/schedules`, `/dashboard/schedule` | covered | schedules*.spec.ts |
