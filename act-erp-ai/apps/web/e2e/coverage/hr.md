# HR company records onboarding and eligibility

New feature checks are implemented in the named specs; execution evidence is recorded in the HR release notes. Existing punch and kiosk regression specs remain responsible for attendance behavior.

| Server action | Check |
| --- | --- |
| `uploadCompanyDocument` | `hr-company-library.spec.ts`: private draft, metadata, duplicate bytes, new immutable version; unit test admin guard |
| `approveCompanyVersion` | `hr-company-library.spec.ts`: tax record HR-only approval; unit tests block employee-purpose escalation |
| `setCompanyDocumentArchived` | `hr-company-library.spec.ts`: reason and archive state |
| `assignOnboardingTemplate` | `hr-onboarding.spec.ts`: approved version, exact owner, repeated assignment |
| `submitChecklistDocument` | `hr-onboarding.spec.ts`: own evidence and HR review; action tests block foreign evidence |
| `acknowledgeHandbook` | `hr-onboarding.spec.ts`: explicit, immutable, idempotent receipt |
| `reviewOnboardingItem` | `hr-onboarding.spec.ts`: admin acceptance; action tests for stale/unsubmitted/immutable-receipt corrections |
| `saveBenefitEligibilityPolicy` | `hr-benefits.spec.ts`: policy and proposed date; action tests admin authorization |
| `endBenefitEligibilityPolicy` | Focused action tests: typed date/optimistic policy end; browser coverage planned |
| `saveBenefitEligibilityAssessment` | `hr-benefits.spec.ts`: employee assessment and no enrollment side effects |
| `saveBenefitPlanMetadata` | Focused action tests: approved resource and metadata guard; browser coverage planned |
| `getEmployeeNotes` | `hr-employee-notes.spec.ts`: employee cannot open private HR notes; unit test admin guard |
| `createEmployeeNote` | `hr-employee-notes.spec.ts`: note date/type/author, private body, no status or punch mutation |
| `updateEmployeeNote` | `hr-employee-notes.spec.ts`: immutable revision history and two stale editors |
| `archiveEmployeeNote` | `hr-employee-notes.spec.ts`: reason, retained history and admin-only archived view |

| Route | Check |
| --- | --- |
| `api/company-documents/[versionId]/file` | `hr-company-library.spec.ts` and `hr-onboarding.spec.ts`: company payroll isolation and exact assigned employee bytes; route unit tests deny unknown assignments |
| `onboard/[token]/files/[versionId]` | `hr-onboarding.spec.ts`: exact invite binding, expiry/completion, and assigned-template bytes |
