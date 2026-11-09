import { EmployeeHoursWorkspace } from "../workspace";
export const metadata = { title: "Employee approvals" };
export default function EmployeeApprovalsPage(props: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  return <EmployeeHoursWorkspace {...props} approvalsOnly />;
}
