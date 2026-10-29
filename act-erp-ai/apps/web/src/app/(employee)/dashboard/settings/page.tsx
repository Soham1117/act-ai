import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { readEmployeePrivateDetails } from "@/server/employee-private-data";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { ChangePasswordForm } from "./change-password-form";
import { KioskPinForm } from "./kiosk-pin-form";
import { PersonalEmailForm } from "./personal-email-form";
import { W2ConsentForm } from "./w2-consent-form";
import { BenefitsConsentForm } from "./benefits-consent-form";
import { env } from "@/lib/env";
import { DEFAULT_KIOSK_PIN, isDefaultPin } from "@/lib/kiosk-pin";
import { getPortalLanguage } from "@/lib/portal-i18n/server";
import { PortalLanguageSwitch } from "@/components/portal-language";

export async function generateMetadata() {
  const { t } = await getPortalLanguage();
  return { title: t("account.settings.title") };
}

export default async function SettingsPage() {
  const user = await requireUser();
  const { t, enumLabel } = await getPortalLanguage();
  const employeeRow = user.employeeId
    ? await db.employee.findUnique({
        where: { id: user.employeeId },
        select: {
          id: true,
          privateDetails: true,
          personalEmail: true,
          w2ConsentAt: true,
          benefitsEConsentAt: true,
          kioskPinHash: true,
        },
      })
    : null;
  const personalEmail = employeeRow ? (await readEmployeePrivateDetails(employeeRow)).personalEmail : null;
  // Only name the temporary PIN while it is still the one in use.
  const onTemporaryPin = await isDefaultPin(employeeRow?.kioskPinHash);
  const canWrite = user.accessLevel === "FULL";
  const readOnlyNote = (
    <p className="text-xs text-muted-foreground">{t("account.settings.readOnly")}</p>
  );
  return (
    <>
      <PageHeader
        title={t("account.settings.title")}
        description={t("account.settings.description")}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("account.settings.account")}</CardTitle>
            <CardDescription>
              {user.email ?? t("account.settings.usernameSignIn")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row label={t("account.settings.name")} value={user.name} />
            <Row label={t("account.settings.role")} value={enumLabel(user.role)} />
            <Row
              label={t("account.settings.employeeId")}
              value={user.employeeId ?? "—"}
              mono
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("account.settings.appearance")}
            </CardTitle>
            <CardDescription>
              {t("account.settings.appearanceDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">{t("account.settings.theme")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("account.settings.themeDefault")}
                </p>
              </div>
              <ThemeToggle />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("account.settings.password")}</CardTitle>
            <CardDescription>{t("account.settings.passwordDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>

        {user.employeeId && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("account.settings.kioskPin")}
              </CardTitle>
              <CardDescription>
                {onTemporaryPin
                  ? t("account.settings.temporaryPin", { pin: DEFAULT_KIOSK_PIN })
                  : t("account.settings.changeKioskPin")}
              </CardDescription>
            </CardHeader>
            <CardContent>{canWrite ? <KioskPinForm /> : readOnlyNote}</CardContent>
          </Card>
        )}

        {user.employeeId && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("account.settings.twoFactor")}
              </CardTitle>
              <CardDescription>
                {env.LOGIN_2FA_ENABLED === "true"
                  ? t("account.settings.twoFactorEnabled")
                  : t("account.settings.twoFactorPaused")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {canWrite ? (
                <PersonalEmailForm
                  current={personalEmail ?? ""}
                  required={env.LOGIN_2FA_ENABLED === "true"}
                />
              ) : (
                readOnlyNote
              )}
            </CardContent>
          </Card>
        )}

        {user.employeeId && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("account.settings.w2Delivery")}
              </CardTitle>
              <CardDescription>{t("account.settings.paperDefaultOptIn")}</CardDescription>
            </CardHeader>
            <CardContent>
              {canWrite ? (
                <W2ConsentForm consented={!!employeeRow?.w2ConsentAt} />
              ) : (
                readOnlyNote
              )}
            </CardContent>
          </Card>
        )}

        {user.employeeId && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("account.settings.benefitsDelivery")}
              </CardTitle>
              <CardDescription>{t("account.settings.paperDefaultOptIn")}</CardDescription>
            </CardHeader>
            <CardContent>
              {canWrite ? (
                <BenefitsConsentForm consented={!!employeeRow?.benefitsEConsentAt} />
              ) : (
                readOnlyNote
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">{t("common.language")}</CardTitle>
          <CardDescription>{t("common.languageDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <PortalLanguageSwitch />
        </CardContent>
      </Card>

      <p className="mt-6 text-xs text-muted-foreground">
        <Link href="/privacy" target="_blank" className="hover:underline">
          {t("account.settings.privacyNotice")}
        </Link>{" "}
        {t("account.settings.privacyDescription")}
      </p>
    </>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b pb-2 last:border-b-0 last:pb-0">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={mono ? "font-mono text-sm" : "text-sm"}>{value}</p>
    </div>
  );
}
