import { EmployeeHoursWorkspace } from "./workspace";
export const metadata = { title: "Employee hours" };
export default function EmployeeHoursPage(props: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  return <EmployeeHoursWorkspace {...props} />;
}
