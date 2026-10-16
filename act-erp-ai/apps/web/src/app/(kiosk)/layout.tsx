import { Providers } from "@/components/providers";
import { VersionWatcher } from "./kiosk/version-watcher";

// Kiosk routes use a fullscreen layout — no app sidebar.
export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className="dark min-h-screen bg-background text-foreground">{children}</div>
      <VersionWatcher />
    </Providers>
  );
}
