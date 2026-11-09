import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { adminWatchData } from "@/server/queries/watch";
import { WatchWorkspace } from "./workspace";

export const metadata = { title: "Watch" };
export const dynamic = "force-dynamic";

export default async function WatchPage() {
  const data = await adminWatchData();
  return (
    <>
      <PageHeader
        title="Watch"
        description="Automatic checks flag issues for review. Draft corrections require an admin to verify and approve the change."
        actions={
          <div className="flex flex-wrap gap-4">
          <Link href="/admin/watch/proposals" className="text-sm underline underline-offset-4">Draft corrections</Link>
          <Link href="/admin/watch/rules" className="text-sm underline underline-offset-4">
            Rules and settings
          </Link>
          </div>
        }
      />
      <WatchWorkspace data={data} />
    </>
  );
}
