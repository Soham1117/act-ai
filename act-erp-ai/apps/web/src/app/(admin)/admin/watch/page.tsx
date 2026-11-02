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
        description="Flags raised by automatic checks. Nothing here changes hours, pay or employee records."
      />
      <WatchWorkspace data={data} />
    </>
  );
}
