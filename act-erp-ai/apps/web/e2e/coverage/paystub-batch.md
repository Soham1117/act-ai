# Reviewed paystub batches

| Server action | Verification |
| --- | --- |
| `previewPaystubBatch` | `paystub-batch.spec.ts`: synthetic combined PDF, one review row per page, exact-page preview, unsupported summary/scan hold and no writes; `paystub-batch-actions.test.ts`: direct admin guard and bounded errors. |
| `confirmPaystubBatch` | `paystub-batch.spec.ts`: selected-page distribution, owner-only downloads, repeated source skip and preservation of attendance; `paystub-batch-actions.test.ts` and `paystub-persistence.test.ts`: stale evidence, manual/OCR/date confirmations, precise replacement, atomic audit/notification, partial failures and retries. |

Textract adapter behavior and sensitive page-object isolation have focused synthetic unit tests. Real source sample validation is read-only and kept outside committed fixtures. The older `payroll-documents.spec.ts` uploader expectations predate explicit per-page review; use the new batch scenarios for this changed flow. Existing download/consent and payroll calculation scenarios retain their purpose.
