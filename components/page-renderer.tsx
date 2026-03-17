"use client";

import { formatValue } from "@/lib/format";
import type { PageDoc } from "@/lib/types";

function GenericTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (!rows.length) return <div className="text-sm text-slate-500">ไม่มีข้อมูล</div>;
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  return (
    <div className="overflow-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-900 text-white">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-4 py-3 text-left font-semibold">{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} className="border-t border-slate-100">
              {columns.map((column) => (
                <td key={column} className="px-4 py-3 align-top text-slate-700">{String(row[column] ?? "-")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PageRenderer({ page }: { page: PageDoc }) {
  const data = (page.data ?? {}) as Record<string, any>;
  const summaryData = (data.summaryData ?? page.headline ?? {}) as Record<string, unknown>;
  const monthlyData = (data.monthlyData ?? data.monthlyRows ?? []) as Array<Record<string, unknown>>;
  const dailyData = (data.dailyData ?? []) as Array<Record<string, unknown>>;
  const quarterlyData = (data.quarterlyData ?? data.quarterRows ?? []) as Array<Record<string, unknown>>;
  const detailRecords = (data.detailRecords ?? data.costItems ?? data.transportCosts ?? data.failedKpis ?? []) as Array<Record<string, unknown>>;

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-yellow-600">{page.type}</p>
        <h1 className="mt-1 text-3xl font-black">{page.title}</h1>
        <p className="mt-2 text-sm text-slate-500">แสดงผลจากข้อมูลกลางบน Firestore โดยคงข้อมูล KPI เดิมไว้</p>
      </div>

      {Object.keys(summaryData).length > 0 && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          {Object.entries(summaryData).map(([key, value]) => (
            <div key={key} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{key}</p>
              <p className="mt-2 text-2xl font-black text-slate-900">{typeof value === "number" ? formatValue(value, page.unit) : String(value)}</p>
            </div>
          ))}
        </div>
      )}

      {monthlyData.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-black">Monthly Data</h2>
          <GenericTable rows={monthlyData} />
        </section>
      )}

      {dailyData.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-black">Daily Data</h2>
          <GenericTable rows={dailyData} />
        </section>
      )}

      {quarterlyData.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-black">Quarterly Data</h2>
          <GenericTable rows={quarterlyData} />
        </section>
      )}

      {detailRecords.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-black">Detail Records</h2>
          <GenericTable rows={detailRecords} />
        </section>
      )}

      {page.type === "detail_records" && data.causeStats && (
        <section className="rounded-3xl border border-slate-200 bg-white p-5">
          <h2 className="text-xl font-black">Cause Stats</h2>
          <pre className="mt-3 overflow-auto rounded-2xl bg-slate-50 p-4 text-sm">{JSON.stringify(data.causeStats, null, 2)}</pre>
        </section>
      )}
    </div>
  );
}
