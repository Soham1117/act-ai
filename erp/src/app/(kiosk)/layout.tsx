// Kiosk routes use a fullscreen layout — no app sidebar.
export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return <div className="dark min-h-screen bg-background text-foreground">{children}</div>;
}
