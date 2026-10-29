import { myBenefitEligibility } from "@/server/queries/benefit-eligibility";
import { eligibilityStateLabel } from "@/lib/benefit-eligibility";
import { getPortalLanguage } from "@/lib/portal-i18n/server";

export async function BenefitEligibilitySummary() {
  const { t, locale, formatDateOnly } = await getPortalLanguage();
  const rows = await myBenefitEligibility();
  if (!rows.length) return null;
  const spanish = locale === "es";
  const stateLabels = spanish
    ? {
        REVIEW_REQUIRED: "Requiere revisión de RR. HH.",
        NOT_ELIGIBLE: "No elegible",
        NOT_YET_ELIGIBLE: "Aún no elegible",
        ELIGIBLE_TO_APPLY: "Elegible para solicitar",
      }
    : eligibilityStateLabel;
  const enrollmentLabels: Record<string, string> = spanish
    ? {
        Enrolled: "Inscrito",
        "Pending enrollment": "Inscripción pendiente",
        Waived: "Renunció a la cobertura",
      }
    : {
        Enrolled: "Enrolled",
        "Pending enrollment": "Pending enrollment",
        Waived: "Waived",
      };
  return (
    <section
      aria-labelledby="eligibility-heading"
      className="space-y-3 rounded-lg border p-4"
    >
      <h2 id="eligibility-heading" className="font-semibold">
        {spanish ? "Elegibilidad de inscripción" : "Enrollment eligibility"}
      </h2>
      <p className="max-w-prose text-sm text-muted-foreground">
        {spanish
          ? "Estas son fechas propuestas para solicitar la inscripción. Su cobertura y sus elecciones de jubilación confirmadas se muestran por separado abajo."
          : "These are proposed dates for applying. Your confirmed coverage and retirement elections remain listed separately below."}
      </p>
      <dl className="grid gap-4 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.benefitType} className="text-sm">
            <dt className="font-medium">
              {t(`records.benefits.type.${row.benefitType}`)}
            </dt>
            <dd>
              {row.enrollmentLabel
                ? enrollmentLabels[row.enrollmentLabel]
                : stateLabels[row.state]}
            </dd>
            {!row.enrollmentLabel &&
              row.state !== "REVIEW_REQUIRED" &&
              row.proposedDate && (
                <dd className="text-muted-foreground">
                  {spanish ? "Fecha propuesta" : "Proposed date"}:{" "}
                  {formatDateOnly(row.proposedDate)}
                </dd>
              )}
            {!row.enrollmentLabel && (
              <dd className="text-xs text-muted-foreground">
                {spanish
                  ? "RR. HH. debe confirmar la elegibilidad y el proveedor debe confirmar la inscripción."
                  : row.reason}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}
