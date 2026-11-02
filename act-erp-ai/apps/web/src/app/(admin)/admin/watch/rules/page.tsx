import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { RULE_LABELS } from "@/lib/watch/catalog";
import { ALL_JOBS } from "@/server/watch/jobs";
import { loadPolicy } from "@/server/watch/runner";
import { RulesWorkspace } from "./workspace";

export const metadata = { title: "Watch rules" };
export const dynamic = "force-dynamic";

export default async function WatchRulesPage() {
  await requireAdmin();
  const [configs, policy] = await Promise.all([db.watchRuleConfig.findMany(), loadPolicy()]);
  const enabled = new Map(configs.map((c) => [c.ruleId, c.enabled]));
  const rules = ALL_JOBS.map((j) => ({
    id: j.id,
    label: RULE_LABELS[j.id]?.label ?? j.id,
    group: RULE_LABELS[j.id]?.group ?? "Other",
    enabled: enabled.get(j.id) ?? j.defaultEnabled ?? true,
    offByDefault: j.defaultEnabled === false,
  }));
  return (
    <>
      <PageHeader
        title="Watch rules and settings"
        description="Turn checks on or off and change the numbers they use. Changes apply on the next check."
        actions={
          <Link href="/admin/watch" className="text-sm underline underline-offset-4">
            Back to Watch
          </Link>
        }
      />
      <RulesWorkspace rules={rules} policy={policy} />
    </>
  );
}
