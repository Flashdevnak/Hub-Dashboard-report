"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./auth-provider";

export function RequireAuth({
  children,
  adminOnly = false,
  branchEditorAllowed = false
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
  branchEditorAllowed?: boolean;
}) {
  const { loading, firebaseUser, profile } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (loading) return;
    const nextPath = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
    if (!firebaseUser) {
      router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
      return;
    }
    if (adminOnly && profile?.role !== "admin") {
      router.replace("/");
      return;
    }
    if (branchEditorAllowed && !["admin", "branch_admin"].includes(profile?.role || "")) {
      router.replace("/");
    }
  }, [loading, firebaseUser, profile, adminOnly, branchEditorAllowed, router, pathname, searchParams]);

  const deniedForRole = adminOnly ? profile?.role !== "admin" : branchEditorAllowed ? !["admin", "branch_admin"].includes(profile?.role || "") : false;

  if (loading || !firebaseUser || deniedForRole) {
    return <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-slate-500">กำลังตรวจสอบสิทธิ์...</div>;
  }

  return <>{children}</>;
}
