"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./auth-provider";
import type { SiteConfig } from "@/lib/types";

export function AppShell({
  site,
  children
}: {
  site: SiteConfig;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile, logout } = useAuth();
  const groups = Array.from(new Set(site.nav.map((item) => item.group)));
  const allBranches = site.branches?.length ? site.branches : [{ code: "default", name: "สาขาหลัก", active: true }];
  const visibleBranches = profile?.role === "admin"
    ? allBranches.filter((branch) => branch.active !== false)
    : allBranches.filter((branch) => branch.active !== false && (profile?.allowedBranches || [site.defaultBranchCode || "default"]).includes(branch.code));
  const fallbackBranch = visibleBranches[0]?.code || site.defaultBranchCode || allBranches[0].code;
  const [selectedBranch, setSelectedBranch] = useState(searchParams.get("branch") || fallbackBranch);

  useEffect(() => {
    const requested = searchParams.get("branch") || localStorage.getItem("bnak_branch") || fallbackBranch;
    const nextBranch = visibleBranches.some((branch) => branch.code === requested) ? requested : fallbackBranch;
    setSelectedBranch(nextBranch);
    localStorage.setItem("bnak_branch", nextBranch);
  }, [searchParams, fallbackBranch, JSON.stringify(visibleBranches.map((branch) => branch.code))]);

  const branchName = useMemo(
    () => allBranches.find((branch) => branch.code === selectedBranch)?.name || selectedBranch,
    [allBranches, selectedBranch]
  );

  function withBranch(href: string) {
    return `${href}${href.includes("?") ? "&" : "?"}branch=${encodeURIComponent(selectedBranch)}`;
  }

  function onBranchChange(branchCode: string) {
    setSelectedBranch(branchCode);
    localStorage.setItem("bnak_branch", branchCode);
    const params = new URLSearchParams(searchParams.toString());
    params.set("branch", branchCode);
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="w-[290px] shrink-0 border-r border-slate-200 bg-white p-5">
          <div className="border-b border-slate-200 pb-4">
            <h1 className="text-2xl font-black tracking-tight">{site.appName}</h1>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">{site.brand}</p>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">สาขาที่กำลังดู</p>
            <select
              value={selectedBranch}
              onChange={(event) => onBranchChange(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
            >
              {visibleBranches.map((branch) => (
                <option key={branch.code} value={branch.code}>{branch.name}</option>
              ))}
            </select>
            <p className="mt-2 text-xs text-slate-500">รองรับหลายสาขา พร้อมจำกัดสิทธิ์ตามสาขาที่ผู้ใช้ถูกมอบหมาย</p>
          </div>

          <nav className="mt-4 space-y-5">
            {groups.map((group) => (
              <div key={group}>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{group}</p>
                <div className="space-y-1">
                  {site.nav.filter((item) => item.group === group).map((item) => {
                    const href = item.slug === "dashboard" ? "/" : `/pages/${item.slug}`;
                    const active = pathname === href;
                    return (
                      <Link
                        key={item.slug}
                        href={withBranch(href)}
                        className={[
                          "block rounded-xl px-3 py-2 text-sm transition",
                          active ? "bg-yellow-50 font-semibold text-amber-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                        ].join(" ")}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs text-slate-500">เข้าสู่ระบบเป็น</p>
            <p className="font-semibold">{profile?.email ?? "-"}</p>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{profile?.role ?? "guest"}</p>
            <p className="mt-2 text-xs text-slate-500">สาขา: {branchName}</p>
            {profile?.allowedBranches?.length ? <p className="mt-1 text-xs text-slate-500">สิทธิ์: {profile.allowedBranches.join(", ")}</p> : null}
            <div className="mt-3 flex gap-2">
              {profile?.role === "admin" || profile?.role === "branch_admin" ? (
                <Link href={withBranch("/admin")} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white">
                  หลังบ้าน
                </Link>
              ) : null}
              <button onClick={() => logout()} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold">
                ออกจากระบบ
              </button>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
