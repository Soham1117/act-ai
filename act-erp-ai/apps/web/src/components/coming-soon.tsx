import { PageHeader, EmptyState } from "@/components/page-header";
import { Sparkles } from "lucide-react";

export function ComingSoon({
  title,
  phase,
}: {
  title: string;
  phase: string;
}) {
  return (
    <>
      <PageHeader title={title} description={`Ships in ${phase}.`} />
      <EmptyState
        icon={<Sparkles className="h-5 w-5" />}
        title="Coming soon"
        description={`This screen will be built in ${phase}. The data model and API are scaffolded — only the UI is pending.`}
      />
    </>
  );
}
