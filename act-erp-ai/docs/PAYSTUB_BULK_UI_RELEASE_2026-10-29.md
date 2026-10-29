# Paystub bulk UI release - 2026-10-29

Status: deployed and verified on production at 2026-10-29T13:44:34.232372+00:00.

## Scope

Only these source files were overlaid onto the existing production source tree:

- `apps/web/src/app/(admin)/admin/payroll/batch-paystubs-panel.tsx`
- `apps/web/src/lib/paystub-bulk-review.ts`

Added bulk selection/review controls and larger checkbox hit areas. Existing exact duplicates, skipped/unsupported pages and completed receipts remain excluded from bulk changes. Employee assignment, dates, reasons and server import validation are unchanged.

Remote/local comparison found only the intended payroll UI differences and the new helper. No KMS code, packages, environment settings, schema changes or database mutations were deployed.

## Verification

- Existing remote Dockerfile production image build passed.
- Isolated candidate container: DB-backed `/api/health` and `/login` both returned 200.
- Candidate UI bundle contains both bulk-control accessible labels.
- Web-only replacement; PostgreSQL and shared Caddy were not restarted.
- Deployed container became healthy; public HTTPS `/api/health` and `/login` returned 200.
- Deployed image and bundled UI checksums match the warmed candidate.
- No authenticated payroll upload was performed during deployment, so no employee/payroll data was changed. Local focused tests/typecheck/lint were reported passing before release.

## Release artifacts

- Server release directory: `/home/ubuntu/act-releases/paystub-bulk-ui-20261029T134103Z/`
- New image: `sha256:c9c57266a83847d7a89f1836ae97b6033b4f485b28aecb935356580416cfada6`
- Previous image: `sha256:1e368befe00db691fc4db5baaf4c1194e5a55231dfe59a41a238011ced55503e`
- Previous image retained as `act-erp-lite-web:before-paystub-bulk-ui-20261029T134103Z`.
- Private source backup: `source-before.tar.gz`; database safety backup: `database-before.sql.gz`.
- Build/switch logs, source manifest, artifact manifest, warm checks and release result retained in the release directory.

### Source SHA-256

- `src/app/(admin)/admin/payroll/batch-paystubs-panel.tsx`: `a980876b0dcd5f258021c1e527179ea1fb86d9e127639324be49804db07882b3`
- `src/lib/paystub-bulk-review.ts`: `6c97399a11e1e040eff1b31c002f4c0ef4e34abdcf4440ec31998c2dd60b853e`

### UI artifact SHA-256

- Build ID: `mvtlde08-1flqoz`
- `/app/.next/static/chunks/0.12da1le7jo2.js`: `a212f44205b1691620841eb98a20ea4cae24859497978fb2fa13dd8b468c108b`

## Rollback

The deployment script automatically restores the prior image and scoped sources if its post-switch checks fail. For any later rollback, use the saved previous image and a web-only compose restart; restore the two scoped source paths from the source backup, removing only the helper if marked new in `new-files.json`. Never restore the database backup over new live attendance/payroll activity.
