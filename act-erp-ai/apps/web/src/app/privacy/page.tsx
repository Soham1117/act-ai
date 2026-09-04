import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo } from "@/components/logo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Privacy notice" };

export default function PrivacyPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between p-6">
        <Logo priority width={140} height={56} className="h-9" />
        <ThemeToggle />
      </header>

      <main className="flex-1 mx-auto w-full max-w-2xl space-y-6 p-6 pb-16">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Employee data privacy notice</h1>
          <p className="text-sm text-muted-foreground">
            American Completion Tools · ACT Persona (internal HR/payroll system)
            <br />
            Last updated: August 2026
          </p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">What we collect</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>To administer employment, we collect and store:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Name, contact information, and address</li>
              <li>The <strong>last 4 digits only</strong> of your Social Security Number — we never collect or store the full number</li>
              <li>Time clock records, schedules, and leave/reimbursement requests</li>
              <li>Payroll documents you or an admin upload (pay stubs, and — only if you&apos;ve separately consented — your W-2)</li>
              <li>Your personal email, used only to send sign-in verification codes</li>
              <li>A profile photo, if one is uploaded</li>
              <li>An audit log of account and record changes (who did what, and when)</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Why</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              Solely to run HR and payroll operations: paying you correctly,
              tracking time and leave, verifying your identity at login and at
              kiosk terminals, and keeping the records federal and Texas
              employment law require us to keep. We don&apos;t sell, rent, or
              use this data for advertising.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">How it&apos;s protected</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <ul className="list-disc space-y-1 pl-5">
              <li>Every login requires a password <em>and</em> a one-time code emailed to your personal email</li>
              <li>Access is role-based — most records are visible only to you and HR admins</li>
              <li>Uploaded documents are stored encrypted and are never publicly accessible</li>
              <li>Kiosk clock-in requires a PIN, stored only as a secure hash</li>
              <li>Account and record changes are logged</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">How long we keep it</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              Payroll records are kept at least 3 years and time/wage
              computation records at least 2 years, per federal (FLSA) and
              Texas Payday Law requirements. We don&apos;t delete records
              early just because employment ends, since these retention
              periods are a legal floor, not a target.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Your choices</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <ul className="list-disc space-y-1 pl-5">
              <li>You choose and can update the personal email your sign-in codes go to (Settings)</li>
              <li>Your W-2 is delivered on paper unless you separately opt in to electronic delivery — and you can withdraw that at any time (Settings)</li>
              <li>Benefits plan documents (SPDs, summaries) are delivered on paper unless you separately opt in to electronic delivery — and you can withdraw that at any time (Settings). This doesn&apos;t affect your own coverage details on the Benefits page, which are always available to you regardless</li>
              <li>You can replace the temporary kiosk PIN with your own PIN in Settings</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">If something goes wrong</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              If a security incident affects your personal information, we
              will notify you within 60 days of discovering it, consistent
              with the Texas Identity Theft Enforcement and Protection Act.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Questions</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              Contact HR or your administrator. This notice describes what
              this system does today and may be updated as the system changes.
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">Back to sign in</Link>
        </p>
      </main>

      <footer className="p-6 text-center text-[11px] text-muted-foreground">
        © {new Date().getFullYear()} American Completion Tools
      </footer>
    </div>
  );
}
