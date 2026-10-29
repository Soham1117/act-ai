import { maskAccountNumber } from "@/lib/onboarding-packet";

type PacketRow = {
  consentVersion: string;
  submittedAt: Date;
  application: unknown;
  drugAlcohol: unknown;
  background: unknown;
  directDeposit: unknown;
  handbook: unknown;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "—" : String(v);
}

function maskedSensitive(value: unknown): string {
  return typeof value === "string" && value.trim() ? maskAccountNumber(value) : "—";
}

export function OnboardingPacketPanel({ packet }: { packet: PacketRow | null }) {
  if (!packet) {
    return (
      <div className="rounded-md border p-4 text-sm text-muted-foreground">
        No digital new-hire packet on file for this employee.
      </div>
    );
  }

  const dd = asRecord(packet.directDeposit);
  const drug = asRecord(packet.drugAlcohol);
  const bg = asRecord(packet.background);
  const hb = asRecord(packet.handbook);
  const app = asRecord(packet.application);

  const employers = Array.isArray(app.employers) ? app.employers : [];

  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-muted-foreground">
        Submitted {packet.submittedAt.toISOString().slice(0, 10)} · consent{" "}
        {packet.consentVersion}
      </p>

      <section className="space-y-1 rounded-md border p-3">
        <h3 className="font-medium">Direct deposit</h3>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Bank</dt>
          <dd>{str(dd.bankName)}</dd>
          <dt className="text-muted-foreground">Location</dt>
          <dd>{str(dd.bankLocation)}</dd>
          <dt className="text-muted-foreground">Routing</dt>
          <dd className="font-mono">{maskedSensitive(dd.routingNumber)}</dd>
          <dt className="text-muted-foreground">Account</dt>
          <dd className="font-mono">{maskedSensitive(dd.accountNumber)}</dd>
          <dt className="text-muted-foreground">Type</dt>
          <dd>{str(dd.accountType)}</dd>
          <dt className="text-muted-foreground">Signed as</dt>
          <dd>{str(dd.printedName)}</dd>
        </dl>
      </section>

      <section className="space-y-1 rounded-md border p-3">
        <h3 className="font-medium">Consents</h3>
        <ul className="space-y-1 text-xs">
          <li>
            Drug/alcohol: {drug.accepted ? "accepted" : "—"} by {str(drug.printedName)}
          </li>
          <li>
            Background: {bg.accepted ? "accepted" : "—"} by {str(bg.printedName)}
          </li>
          <li>
            Handbook: {hb.accepted ? "accepted" : "—"} by {str(hb.printedName)}
            {hb.title ? ` · ${str(hb.title)}` : ""}
          </li>
        </ul>
      </section>

      <section className="space-y-1 rounded-md border p-3">
        <h3 className="font-medium">Application</h3>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Position</dt>
          <dd>{str(app.positionApplied)}</dd>
          <dt className="text-muted-foreground">Can begin</dt>
          <dd>{str(app.dateCanBegin)}</dd>
          <dt className="text-muted-foreground">Min salary</dt>
          <dd>{str(app.minSalary)}</dd>
          <dt className="text-muted-foreground">Work in USA</dt>
          <dd>{str(app.workInUsa)}</dd>
          <dt className="text-muted-foreground">Felony</dt>
          <dd>
            {str(app.felony)}
            {app.felonyExplain ? ` — ${str(app.felonyExplain)}` : ""}
          </dd>
          <dt className="text-muted-foreground">DL</dt>
          <dd>
            {maskedSensitive(app.driversLicenseNumber)} {str(app.driversLicenseState)}
          </dd>
        </dl>
        {employers.length > 0 && (
          <div className="mt-2 space-y-1">
            <p className="text-xs font-medium">Employers</p>
            {employers.map((raw, i) => {
              const e = asRecord(raw);
              if (!e.name) return null;
              return (
                <p key={i} className="text-xs text-muted-foreground">
                  {str(e.name)}
                  {e.position ? ` · ${str(e.position)}` : ""}
                  {e.startDate || e.endDate
                    ? ` (${str(e.startDate)} – ${str(e.endDate)})`
                    : ""}
                </p>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
