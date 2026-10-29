# HR onboarding benefits and compliance documents

Proposed October 28, 2026. Local files have been extracted and categorized. This is an implementation plan only: no application deployment, document publication, benefits enrollment, payroll upload, or employee change is authorized by this planning step.

## What HR is asking for

Treat HR's document list and eligibility statements as source information, and the requested centralized record keeping as a product suggestion. The recommended product changes below make that information usable without turning an attachment into a new company policy.

| HR input | Classification | Planned response |
| --- | --- | --- |
| New hire packet, I-9, W-4, handbook | Existing source documents | Versioned templates, a new-hire checklist, document review, and handbook acknowledgment |
| BCBS medical/dental enrollment form and three medical plans | Existing forms and plan information | Link the correct forms and summaries to the existing benefit catalog |
| S9J7ADT is the base plan; the other two are buy-up plans | HR-provided plan designation | Identify S9J7ADT as Base; G9E5ADT and P611ADT as Buy-up; enter confirmed employee costs separately |
| Medical/vision: first of the month after 60 days | HR-provided eligibility rule | Calculate and display a proposed eligibility date, with HR-reviewed exceptions |
| 401(k) online self-registration, one year of service, April 1 / October 1 entry dates | HR-provided process and rule | Show the provider portal and next proposed entry date; keep actual enrollment externally confirmed |
| Central place for payroll compliance documents and annual W-2/W-3 etc. | Explicit product suggestion | A private company record library, indexed by category, tax year, period, and document purpose |
| Company introduction and basic safety training | Explicit discussion with Deepak | Deferred; no training content or required tasks added in this release |
| API new-hire requirements and job descriptions, three samples out of 22 | Explicit discussion with Deepak | Deferred; retain supplied files as reference, do not infer a software API integration or implement role requirements |

## Files organized locally

Folder: `D:/Deployed Projects/ACT Persona/Paystubs`.

- Extracted 27 entries from `HR files others.zip` and `Fw__AMERICAN_COMPLETION_TOOLS_INC_-_Q3_2026_PAYROLL_RETURNS.zip`.
- Extracted eight additional PDF reports from the two included email messages. Their two paystub attachments matched existing PDFs by SHA-256 and were reused instead of duplicated.
- Verified all extracted bytes against their archive/email source. Original ZIPs and email messages remain unchanged. The earlier year-to-date paystub archive and existing paystub PDFs remain in place.
- Categories: New Hire Forms; Benefits; Payroll Compliance; Year End Tax Forms; Payroll Summaries; Payroll Correspondence; Corporate Tax; Job Descriptions/Deferred.
- `ACT_2019-20_1120[1826924].pdf` is retained separately under Corporate Tax rather than being mislabeled as a quarterly payroll return.
- See `HR_DOCUMENT_INDEX.md`, `HR_EXTRACTION_MANIFEST_2026-10-28.json`, and `HR_EMAIL_ATTACHMENTS_MANIFEST_2026-10-28.json` in that folder for exact paths and hashes.

## Findings that affect implementation

1. Persona already has invite onboarding, employee-owned document uploads, I-9/W-4 upload slots, a benefit plan catalog, per-employee benefit enrollments, retirement elections, notifications, and audit logging. Extend these flows instead of building a second HR application.
2. Current Document rows require an employee owner. A company-wide record cannot be represented safely by attaching it to an arbitrary employee or sending it to everyone. Company record keeping needs a separate company-owned library and access checks.
3. The three medical summaries show a January-December 2025 coverage period. The vision summary shows a July 1, 2024 effective date, and the BCBS enrollment filename says 2025-26. Preserve these files as reference; HR must verify the currently applicable editions before they are shown as current employee benefits. A filename containing Current is not proof that every embedded form is current.
4. The medical summaries state that premiums are provided separately. Do not derive buy-up premiums from deductibles, copays, metal tier, or plan code. Keep employee/employer amounts and monthly/per-paycheck periods explicit in the existing price catalog.
5. The October 2026 handbook's benefits section includes dental alongside medical and vision in the first-of-month-after-60-days rule. HR's message explicitly named only medical/vision. Record dental as supported by the handbook but confirm it against the applicable plan before activating its rule. The handbook itself directs readers to official plan documents for plan terms.
6. The Sentry self-registration guide is marked for internal use only and describes entering identity information at the provider's portal. Keep the supplied guide as an HR reference until approved for employee distribution. Link to the provider; do not reproduce that identity-collection process inside Persona.
7. The supplied new-hire packet is 18 pages and contains an existing checklist, agreements, forms, and a handbook-receipt item. Use it to reconcile required checklist items, not as authority to create additional drug-testing, driving, safety-training, or job-description requirements automatically.
8. The current employment type combines full-time and part-time in FULL_PART_TIME. Hire date alone is therefore insufficient to decide benefit participation for every employee. Require HR-confirmed eligibility classification/assessment; do not infer all employees, interns, temporary staff, or agency workers are eligible.

## Phase 1 Company document library

Add a Company library within the existing admin Documents area, with these uses:

- Onboarding templates and company handbook versions.
- Benefit forms, plan summaries, and HR-only provider guides.
- Quarterly payroll compliance: 941, 940-related payment confirmations, TWC reports, filing/payment confirmations, and payroll backups.
- Annual tax archives: W-2 batches, W-3, and other year-end records.
- Payroll summaries, payroll liability/payment reports, and 401(k) payable reports.
- Other company tax records kept distinct from payroll categories when needed.

Store title, category, document/form type, tax or plan year, quarter/pay date or period, issuing organization, effective/version date, source filename, SHA-256, private storage key, uploader, timestamps, and archive/superseded state. A reference for the source email can be retained without rendering its HTML. First version uploads PDF and appropriate existing document types; it does not require an in-app email/ZIP ingestion service.

Use a company-owned model, for example CompanyDocument with immutable CompanyDocumentVersion records. Keep private records admin-only by default. Approving a version for use as a blank onboarding template or benefit resource is a distinct action; uploading a compliance file never sends it to employees. Reuse existing employee recipient delivery where appropriate rather than widening visibility based on a category name.

Search/filter by category, year, quarter, period, and title. Detect identical uploads by hash, retain a new revision instead of overwriting evidence, and audit upload, version change, archive, download of sensitive records, and publication. Use archive/supersede rather than automatic deletion. No automatic statutory retention schedule or tax filing is introduced.

Employee W-2 delivery remains in the existing per-employee Payroll flow with its current consent and access checks. A company W-2 batch and W-3 are company compliance records, not employee-accessible documents. Never distribute a combined W-2 file through a single employee record.

## Phase 2 Onboarding templates and checklist

- Link HR-approved versions of the new-hire packet, current I-9, current W-4, and handbook to the existing invite/onboarding flow.
- Present relevant blank forms for download and preserve the existing private upload of completed documents. Do not attempt a custom electronic I-9, tax-withholding calculator, automated government filing, or legal e-signature system in this release.
- Persist per-hire checklist items as Not started, Submitted, Needs correction, Accepted, or Not applicable, linked to the uploaded document and exact template version. HR marks acceptance; a file upload alone is not acceptance.
- Add a handbook acknowledgment recording employee identity, handbook version, displayed acknowledgment text, and timestamp. Viewing/downloading a file is not an acknowledgment. Support an HR-recorded signed-paper acknowledgment as evidence. Do not describe this simple receipt as a signature on every legal form.
- Ensure the new hire can access only the approved template versions assigned to that invite, not the company vault or another hire's completed documents. Existing or expired invite links must not expose arbitrary library files.
- Do not prescribe a fixed driver's-license-plus-SSN-card combination as the required I-9 documents. Review the existing identity upload labels when connecting the official form; do not add new restrictions beyond the current official process.
- Track onboarding completeness separately from employee account status. Existing users and hires must not be retroactively blocked by newly introduced requirements.
- HR selects required items from the approved packet. Anything tied to the deferred Deepak discussions stays disabled and out of the required checklist.

## Phase 3 Benefits information and eligibility dates

Extend Benefits with plan code, Base/Buy-up designation, linked document versions, and a small set of typed, effective-dated eligibility policies. Do not build a general rules engine. Preserve existing plan-year pricing and enrollment history.

Medical/vision calculation from HR's rule:

1. Use the employee's business hire date as a date-only value.
2. Add 60 calendar days.
3. Select the first day of the following month.
4. Example: October 28, 2026 -> December 27, 2026 -> January 1, 2027.

Use the same proposed policy for dental only after HR confirms the handbook rule is applicable to the current dental plan. Confirm how exact first-of-month boundaries and hire-day counting are handled before activating the calculation. Use calendar dates in America/Chicago, not UTC timestamp duration arithmetic.

401(k) calculation from HR's rule:

1. Determine the one-year service milestone from an HR-confirmed service date.
2. Select the next applicable April 1 or October 1 entry date.
3. HR's February 2026 hire example produces April 1, 2027. The message's shorthand 2/26 is not a complete hire date; the application still needs the employee's actual date.
4. The proposed rule uses the first entry date on or after the milestone. Confirm exact April 1 / October 1 boundary handling with the plan before enabling it.

Do not infer the full retirement plan year from its two entry dates, use January 1 as an entry date, or assume one calendar year resolves all service requirements. Rehires, credited service, leaves, leap-day anniversaries, age/hour requirements if applicable, and missing dates go to HR review instead of a guessed eligibility decision. The supplied self-registration guide does not establish all plan eligibility terms.

Show separate states for Not yet eligible, Eligibility needs review, Eligible to apply, Pending enrollment, Enrolled, and Waived. Proposed eligibility never creates a coverage row, enrollment, payroll deduction, or retirement election automatically. Existing confirmed coverage is not revoked merely because new eligibility metadata is incomplete.

Employees get the correct approved forms, plan summaries, and an approved external enrollment link. HR sees an upcoming eligibility list and review tasks; reuse existing notifications and deduplicate any eligibility notice by employee, benefit/policy version, and target date. A future queued date must not be represented as an actual enrollment date.

## Data and privacy boundaries

- Keep company library files separate from employee-owned documents and the combined-paystub importer. Reuse authorization/storage/audit helpers, not permissive shared download routes.
- No full SSNs, dependent identities, bank account numbers, health details, or retirement balances are added to new structured fields, search indexes, logs, or notifications.
- Raw completed forms and tax archives can contain sensitive information even when structured employee fields hold only SSN last four. Verify and align the actual document-storage controls and privacy wording before expanding collection; do not claim that raw uploads are necessarily free of full identifiers.
- Versioned templates and acknowledgments, and eligibility-policy versions/assessments, need additive models/fields. Do not weaken Document.employeeId ownership or existing benefits consent handling to avoid a schema change.
- Use small, typed policy records and an HR-confirmed eligibility assessment/classification to cover the missing employee distinctions. Audited service-date adjustments require a reason. Do not reclassify the existing FULL_PART_TIME enum or rewrite historical hire dates as an incidental fix.
- Existing benefits disclosure and W-2 consent paths remain responsible for their employee distributions. An informational library entry does not prove a disclosure was delivered or an enrollment was completed.

## HR verification before employee publication

These checks concern source accuracy, not the deferred manager discussions. They do not prevent building the library, draft catalog, and review UI:

- Obtain/confirm current medical SBCs and vision summary, current enrollment forms, and the current premium/contribution schedule.
- Confirm dental eligibility and the exact waiting-period boundary convention.
- Confirm the retirement plan's service requirements, April/October boundary rule, and approved employee-facing portal instructions.
- Confirm which existing packet items HR requires and which employment classes they apply to.
- Check official I-9 edition/expiration and W-4 revision when activating a template; retain the uploaded originals as historical sources.

Useful official version references: [USCIS Form I-9](https://www.uscis.gov/i-9), [IRS Form W-4](https://www.irs.gov/forms-pubs/about-form-w-4). Current I-9 page/PDF access returned 403 in this session; do not claim a live edition verification was completed merely from the local filename.

## Verification and delivery

1. Implement the company library with private storage, exact authorization, categories, versioning, duplicates, and audit proof. Populate only reviewed draft metadata initially.
2. Connect approved versions to onboarding, add checklist review and handbook acknowledgment, and test invite-scoped file access.
3. Add plan designation and typed eligibility calculations with HR-review states. Review missing employment classification and policy boundaries before activating employee-facing dates.
4. Run unit tests for date calculations and boundary cases; browser tests for upload/review/acknowledgment and eligibility views; direct-action/download tests for employee/admin isolation. Include duplicate uploads, superseded templates, expired invites, and retries without duplicate acknowledgment or notifications.
5. Verify October 28, 2026 -> January 1, 2027 for medical/vision and the February 2026 -> April 1, 2027 retirement example. Test hire+60 landing on a month's first/last day, April/October anniversaries, leap days, year changes, null dates, rehire review, and dental disabled until confirmed.
6. Run the production build and existing onboarding/documents/benefits/payroll checks. Back up before the additive schema update, follow the existing deploy runbook, and retain old builds and data for rollback.

Done means HR can maintain a company compliance archive, give new hires the approved forms, review completion and handbook receipts, and see trustworthy proposed benefit dates without exposing company payroll records or pretending external enrollment occurred.

The existing combined-paystub import and structured contract-hours plans remain separate scopes. Company introduction, basic safety training, and API/job-description requirements remain deferred. No tax filing, insurance carrier integration, retirement-provider API, automatic employee data extraction, or OCR service is included.
