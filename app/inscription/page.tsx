import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { register } from "@/app/actions/auth";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Inscription" };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <div className="py-8 sm:py-16">
      <AuthForm action={register} mode="register" />
    </div>
  );
}
