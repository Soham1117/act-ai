# Watch findings

Pure logic is unit tested in `src/lib/watch/*.test.ts`. Browser coverage is planned.

| Server action | Check |
| --- | --- |
| `actOnFinding` | Unit tests for allowed transitions (`status.test.ts`); admin guard; audited. Browser coverage planned |
| `runWatchNow` | Admin guard; shadow run only, audited. Browser coverage planned |

| Route | Check |
| --- | --- |
| `api/internal/watch/run` | Bearer token required, fails closed when unset. Not browser-testable (host cron) |
