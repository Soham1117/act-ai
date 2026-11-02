# AI agent use cases for Persona

Proposed November 2, 2026. Idea list only; nothing here is built or authorized.

Rollout levels (each use case is tagged):
- **L1** Watch and flag (read-only)
- **L2** Digest and summarize (read-only, sent to manager)
- **L3** Draft and queue (agent proposes, human approves)
- **L4** Auto-approve (boring, reversible, logged, undo button)

Rules for every item: the agent uses its own `AGENT` account, every action goes to the audit log, nothing touches money or employment status without a human, and employee-written text is treated as untrusted.

## A. Time and attendance (1-20)

1. **L1** Missing clock-out: punch-in with no out after the scheduled shift ends.
2. **L1** Missing clock-in: scheduled employee with no punch 30 minutes after shift start.
3. **L1** Overtime spike: employee on track to pass 40 hours before the week ends.
4. **L1** Break violation: no break logged on a shift over the legal or policy length.
5. **L1** Break too long or too short against policy.
6. **L1** Impossible shift: over 16 hours, or overlapping punches.
7. **L1** Duplicate punches within a minute (double tap on the kiosk).
8. **L1** Punch outside the employee's normal location or kiosk.
9. **L1** Punch photo missing, blurry, or not matching the profile photo.
10. **L1** Buddy-punching pattern: same photo or timing for different people.
11. **L1** Clock-in far earlier than the schedule, over and over (unpaid early arrival or padding).
12. **L1** Rounding drift: an employee's rounded hours always favor one direction.
13. **L1** Hours worked on a holiday or day off without a manager note.
14. **L1** Schedule vs actual: weekly hours differ from the schedule by more than a set amount.
15. **L3** Draft a punch correction for a forgotten clock-out using the shift end time.
16. **L3** Draft a break correction when the kiosk missed a break-end tap.
17. **L3** Suggest splitting an overlong shift into two with a break.
18. **L4** Auto-approve a punch correction under 15 minutes with a reason code, with undo.
19. **L4** Auto-merge exact duplicate punches, keeping the original.
20. **L4** Auto-fill an obvious missing break-end when the next punch is 30 minutes later.

## B. Contract and agency crew (21-30)

21. **L1** Contract crew punch without a PIN or photo.
22. **L1** Contract worker hours that don't match the agency's invoice estimate.
23. **L1** Contract worker on site with no assigned job code.
24. **L1** Contract worker nearing the limit of days before conversion review.
25. **L2** Weekly contract hours by agency and job code, with the change from last week.
26. **L3** Draft mass-hours entries from the daily crew sheet.
27. **L3** Draft a contract worker to employee conversion checklist.
28. **L1** Contract worker hours billed to the wrong department.
29. **L2** Cost comparison: agency crew vs employees on the same task.
30. **L3** Draft a note to the agency about a no-show pattern.

## C. Payroll preparation (31-50)

31. **L1** Pay-period close blockers: unapproved timesheets, open punches, unresolved flags.
32. **L1** Employee with hours but no pay rate or job code.
33. **L1** Pay rate changed since last period without a recorded reason.
34. **L1** Variance report: any employee whose gross changed by more than 15% from last period.
35. **L1** Total payroll more than 10% above the 4-period average.
36. **L1** Hours in the workbook that differ from the timesheet total.
37. **L1** Negative or zero pay lines.
38. **L1** Employee paid twice in one period, or in two periods for the same dates.
39. **L1** Terminated employee still receiving hours or pay lines.
40. **L1** New hire with hours but missing tax forms (W-4) or I-9.
41. **L1** Missing or malformed SSN last-four on an active employee.
42. **L1** Deduction (benefits, 401k) that doesn't match the employee's current election.
43. **L1** Reimbursement approved but not on any pay period.
44. **L1** Pay period dates that don't line up with the previous period.
45. **L3** Pre-close rehearsal two days early: run the numbers and list what would break.
46. **L3** Draft the TCP-layout workbook and attach a check summary.
47. **L3** Draft adjustments for under- or over-paid hours from the previous period.
48. **L2** Plain-language payroll summary: total, overtime cost, headcount, biggest changes.
49. **L3** Compare the paystub PDFs to the workbook and list mismatches.
50. **L1** Overtime cost forecast for the period if the current pace continues.

## D. Approvals and manager workload (51-62)

51. **L2** Daily digest: "3 things need you, 14 handled".
52. **L2** Weekly digest: trends, repeat offenders, upcoming deadlines.
53. **L3** Approval queue with one-click "approve all clean items" and a reason on every flagged one.
54. **L3** Pre-fill leave request decisions using balance, coverage, and past patterns.
55. **L1** Leave request that would leave a shift under minimum coverage.
56. **L1** Leave balance that would go negative.
57. **L3** Draft reimbursement decisions: receipt present, amount within policy, category matches.
58. **L1** Reimbursement without a receipt, or a duplicate of an earlier one.
59. **L4** Auto-approve reimbursements under a small limit with a receipt and a normal category.
60. **L4** Auto-approve leave that has no coverage conflict and enough balance.
61. **L3** Escalation: items waiting on the manager more than 2 days get a reminder.
62. **L2** Delegation suggestion: send an item to a supervisor when the manager is away.

## E. Employee nudges and notifications (63-75)

63. **L3** "You forgot to clock out" nudge the next morning.
64. **L3** Reminder to confirm a corrected timesheet.
65. **L3** Reminder to finish onboarding paperwork, with the exact missing items.
66. **L3** Reminder that an uploaded document was rejected and why.
67. **L3** Heads-up when approaching overtime.
68. **L3** Open-enrollment and eligibility-date notices to employees.
69. **L3** Birthday and work-anniversary notes to the manager.
70. **L3** Reminder to sign the handbook acknowledgment.
71. **L3** Shift-change notices.
72. **L4** Auto-send template reminders after a set delay, capped at 2 per item.
73. **L3** Translate notices into the employee's portal language.
74. **L1** Employees whose notifications fail or who never open them.
75. **L3** Draft a plain-language explanation when an employee asks "why is my pay lower?"

## F. HR, onboarding and compliance (76-92)

76. **L1** Onboarding items stuck for more than 3 days.
77. **L1** I-9 not completed within 3 business days of the hire date.
78. **L1** Expiring work authorization documents.
79. **L1** Missing handbook acknowledgment.
80. **L1** Benefit eligibility date coming up in the next 30 days.
81. **L1** 401(k) entry date (April 1 or October 1) coming up.
82. **L3** Draft the eligibility review list for HR.
83. **L1** Employment classification missing for a benefit decision.
84. **L1** Employees on a plan with expired plan-year pricing.
85. **L1** Terminated employee still has an active login.
86. **L1** Admin accounts that haven't logged in for 60 days.
87. **L1** Temp passwords never changed.
88. **L3** Draft the offboarding checklist: access, final pay, equipment, documents.
89. **L1** Quarterly filing deadlines (941, TWC) approaching.
90. **L3** Draft a document index entry for newly uploaded company records.
91. **L1** Company records with no category, year, or version.
92. **L1** Employee notes mentioning a termination or resignation with no matching status change.

## G. Data quality and imports (93-102)

93. **L1** Duplicate employees (same person, different spelling).
94. **L1** Nickname vs legal-name mismatches between TCP and paystubs.
95. **L1** Active employee with an empty location, department, or manager.
96. **L1** TCP import rows that failed or were skipped.
97. **L1** Paystub PDFs that don't match any employee.
98. **L3** Draft merge suggestions for duplicate employees (never auto-merge).
99. **L1** Job codes used on punches that no longer exist.
100. **L1** Employees with a placeholder value (such as gender OTHER) that HR should fix.
101. **L3** Draft a clean-up list sorted by how much each item affects payroll.
102. **L1** Schedule history gaps after an import.

## H. Security and system health (103-110)

103. **L1** Failed login bursts or logins from new countries.
104. **L1** Admin actions outside business hours.
105. **L1** Large exports (workbook, payroll, SSN fields) and who ran them.
106. **L1** Sensitive documents downloaded repeatedly by one user.
107. **L1** Kiosk offline or its clock off by more than a minute.
108. **L1** Failed deploys, failed backups, or database size growth.
109. **L1** Agent actions that were undone by a manager (feedback for the trust score).
110. **L2** Weekly agent report: flags raised, accepted, ignored, and false-positive rate.

## I. Creative extras (111-120)

111. **L2** "Ask the system" chat for managers: who is over 40 hours, who is absent, what changed.
112. **L2** Plain-language answer to "why did labor cost go up this period?"
113. **L2** Staffing forecast from past schedules and leave.
114. **L3** Suggest a better weekly schedule to cut overtime.
115. **L2** Per-department overtime heat map.
116. **L2** New-hire ramp report: hours, attendance, and onboarding completion over the first 30 days.
117. **L2** Turnover risk signals: falling hours, more absences, repeated corrections.
118. **L3** Draft a monthly report for the owner, in plain language.
119. **L2** Trust score per rule: promote a rule from L3 to L4 after 20 approvals with no overrides.
120. **L3** Meeting prep for HR: the five open items with context and suggested decisions.

## First five to build

1. #1 Missing clock-out
2. #31 Pay-period close blockers
3. #34 Gross pay variance vs last period
4. #93 Duplicate employees
5. #51 Daily digest

Why these: all read-only, all measurable against what the manager already catches by hand, and none can change pay.
