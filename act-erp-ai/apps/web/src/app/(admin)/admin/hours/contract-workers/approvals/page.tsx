import { ContractHoursWorkspace } from "../workspace";
export const metadata = { title: "Contract worker approvals" };
export default function ContractApprovalsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ContractHoursWorkspace {...props} approvalsOnly />;
}
