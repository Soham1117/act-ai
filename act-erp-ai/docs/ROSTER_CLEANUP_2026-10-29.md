# Roster cleanup - 2026-10-29

Applied to production and verified: 13 missing SSN last-four entries filled; 9 names corrected; 91 employees retained. 36 employees still lack last-four digits.

Employee and linked User names updated together. Transactional updates with audit entries. No profiles merged, deleted or created. Existing SSN values were not overwritten.

## Names corrected

- Quentin Robinson -> Quentin T Robinson
- Chance MIddleton -> Chance Middleton
- Troy Vass -> Troy Dougl Vass
- Julia Paez -> Julia L Paez
- Sarah (Elizabeth) Eaton -> Sarah E Eaton
- Victoria Garcia -> Victoria K Garcia
- Angel Hernandez -> Angel I Hernandez
- Brazos Tidwell -> Brazos Walter W Tidwell
- Jennifer Minier -> Jennifer D Minier

## Missing SSN entries filled

- Edgar Gomez: Paystubs 01-08-2026.pdf, page 6
- John Van Handel: Paystubs 01-08-2026.pdf, page 27
- Troy Vass: Paystubs 03-19-2026.pdf, page 27
- Julia Paez: Paystubs 03-19-2026.pdf, page 15
- Raul Quintero: Paystubs 01-08-2026.pdf, page 4
- Sarah (Elizabeth) Eaton: Paystubs 01-08-2026.pdf, page 29
- Victoria Garcia: Paystubs 01-08-2026.pdf, page 22
- Alfonso Rangel: Paystubs 03-05-2026.pdf, page 21
- Jamie Gonzales: Paystubs 03-05-2026.pdf, page 22
- Sergio Hernandez: Paystubs 03-05-2026.pdf, page 9
- Brazos Tidwell: Paystubs 01-08-2026.pdf, page 17
- Damon Roland: Paystubs 07-09-2026.pdf, page 22
- Jennifer Minier: Paystubs 08-06-2026.pdf, page 28

## Needs HR review

- Alexandro Torres: paystub SSN conflict
- Alejandro A Vazquez: paystub SSN conflict
- Tapan J Sinha: paystub SSN conflict
- Buddy L Allison: paystub SSN conflict
- William Martin: Legal-name match requires review
- Garrett Gross: Legal-name match requires review
- Dee Anna L Tapia: paystub SSN conflict

## Possible duplicate profiles - no merge performed

- Jose Gonzales / Jose Gonzalez (similar names; identity unconfirmed)
- Raul Quintero / Raul Quintero Jr. (similar names; identity unconfirmed)
- Buddy L Allison / Dee Anna L Tapia (shared last-four digits; different names)

## Evidence and limits

- Checked 21 available PDF files, including historical paystubs and duplicate copies.
- Parsed 589 named pages. 97 older pages yielded no name and need manual/OCR review.
- Remaining missing values and unsupported nicknames were left unchanged.
- Jamie Gonzales and Jose Gonzales remain separate.
- No SSN digits are included in this report or new audit entries.

## Recovery

Backup: `/home/ubuntu/persona-deploy-20261028-roster-sync/backups/persona-pre-cleanup-20261029T124532Z.sql.gz`

Script, protected plan and apply log are in `/home/ubuntu/persona-deploy-20261028-roster-sync/`. Do not restore a full backup over live attendance data.
