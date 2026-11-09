import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { adminWatchProposals } from "@/server/queries/watch-proposals";
import { ProposalQueue } from "./proposal-queue";

export const metadata = { title: "Watch draft corrections" };
export const dynamic = "force-dynamic";

export default async function WatchProposalsPage() {
  const proposals = await adminWatchProposals();
  return (
    <>
      <PageHeader
        title="Draft corrections"
        description="Review the evidence and confirm the actual time worked before applying a clock-out correction. Hours remain pending payroll approval."
        actions={<Link href="/admin/watch" className="text-sm underline underline-offset-4">Back to Watch</Link>}
      />
      <ProposalQueue rows={proposals} />
    </>
  );
}
