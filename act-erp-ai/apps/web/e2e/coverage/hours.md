# Hours, Period Export and Mass Hours

| Server action | Verification |
| --- | --- |
| `generateHoursPeriodExport` | `hours-export.test.ts`: weekly overtime per entry (leading week, pending hours counted, rejected never exported, overtime kept with its rate when split by rate, blank rate when none exists). No browser scenario yet (planned). |
| `saveHoursExportTemplate` | planned: no browser or unit scenario yet. |
| `createHoursExportSchedule` | planned: no browser or unit scenario yet. |
| `runHoursExportScheduleNow` | planned: records `lastError` on failure; runner due-window logic has no test yet. |
| `previewMassHours` | planned: no browser or unit scenario yet. |
| `commitMassHours` | planned: active-employee check, break row, per-entry audit and partial-failure message have no scenario yet. |
