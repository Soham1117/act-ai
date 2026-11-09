import { ContractHoursWorkspace } from "./workspace";
export const metadata = { title: "Contract worker hours" };
export default function ContractHoursPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ContractHoursWorkspace {...props} />;
}
