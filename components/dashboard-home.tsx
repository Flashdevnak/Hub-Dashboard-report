"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { PageDoc, SiteConfig } from "@/lib/types";

export function DashboardHome({ pages, site }: { pages: PageDoc[]; site: SiteConfig }) {
  const searchParams = useSearchParams();
  const branchCode = searchParams.get("branch") || site.defaultBranchCode || "default";
  const visiblePages = pages.filter((page) => (page.branchCode || "default") === branchCode);

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] bg-slate-900 p-8 text-white">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-yellow-300">Centralized Data</p>
        <h2 className="mt-2 text-4xl font-black tracking-tight">BNAK KPI Hub</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          ข้อมูลเดิมยังอยู่ครบ แต่ย้ายเป็นค่ากลางบน Firestore, ใช้หลายสาขาได้, และมีหลังบ้านแก้ราย KPI แบบไม่ต้องไล่แก้ JSON ด้วยมือ
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {visiblePages.map((page) => (
          <Link
            key={page.pageId || `${page.branchCode}-${page.slug}`}
            href={`/pages/${page.slug}?branch=${encodeURIComponent(branchCode)}`}
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">{page.type}</p>
            <h3 className="mt-1 text-lg font-black text-slate-900">{page.title}</h3>
            <div className="mt-4 rounded-2xl bg-slate-50 p-4">
              <p className="text-xs text-slate-500">สาขา</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{site.branches?.find((branch) => branch.code === (page.branchCode || "default"))?.name || page.branchCode || "default"}</p>
            </div>
            <p className="mt-4 text-sm text-amber-700">เปิดหน้า KPI →</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
