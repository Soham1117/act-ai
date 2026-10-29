import { redirect } from "next/navigation";
import { getSessionUserForPasswordChange } from "@/lib/auth";

export default async function RootPage() {
  const user = await getSessionUserForPasswordChange();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  redirect(user.role === "ADMIN" ? "/admin" : "/dashboard");
}
