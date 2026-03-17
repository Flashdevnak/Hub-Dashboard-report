"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "./auth-provider";
import {
  buildPageId,
  cloneBranchPages,
  deletePage,
  deleteMappingTemplate,
  exportBundle,
  getAuditLogs,
  getMappingTemplates,
  getUsers,
  importBundle,
  saveMappingTemplate,
  savePage,
  saveSiteConfig,
  updateUserAccess
} from "@/lib/firestore";
import type { AuditEvent, AppUser, Branch, DataBundle, MappingTemplate, PageDoc, Role, SiteConfig, TemplateScope, TemplateSuggestion } from "@/lib/types";



type ImportWizardState = {
  fileName: string;
  rowsBySheet: Record<string, Array<Record<string, unknown>>>;
  workbookSheetNames: string[];
  selectedSheetName: string;
  rows: Array<Record<string, unknown>>;
  sourceColumns: string[];
  mapping: Record<string, string>;
  includeUnmapped: boolean;
  trimBlankRows: boolean;
  templateId?: string;
  templateName?: string;
  templateScope: TemplateScope;
  templatePriority: number;
  templateFallback: boolean;
  templateVendor: string;
  templateFilePattern: string;
  templateSheetName: string;
  suggestedTemplates: TemplateSuggestion[];
};

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function safeParse<T>(text: string): T {
  return JSON.parse(text) as T;
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function normalizeBranches(branches: Branch[]) {
  return branches
    .map((branch) => ({ ...branch, code: branch.code.trim(), name: branch.name.trim() }))
    .filter((branch) => branch.code && branch.name);
}

function inferDatasetKeys(data: Record<string, unknown>) {
  return Object.keys(data).filter((key) => key !== "summaryData");
}

function toEditableString(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function fromEditableString(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (!Number.isNaN(Number(trimmed)) && trimmed !== "") return Number(trimmed);
  if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function getRowColumns(rows: Array<Record<string, unknown>>) {
  return Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
}

function normalizeKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙]+/g, " ")
    .trim();
}

function tokenizeKey(value: string) {
  return normalizeKey(value).split(/\s+/).filter(Boolean);
}

function inferTargetFields(rows: Array<Record<string, unknown>>) {
  return getRowColumns(rows);
}

function scoreColumnMatch(source: string, target: string) {
  const s = normalizeKey(source);
  const t = normalizeKey(target);
  if (!s || !t) return 0;
  if (s === t) return 100;
  const sourceCompact = s.replace(/\s+/g, "");
  const targetCompact = t.replace(/\s+/g, "");
  if (sourceCompact === targetCompact) return 95;
  if (sourceCompact.includes(targetCompact) || targetCompact.includes(sourceCompact)) return 75;
  const sourceTokens = tokenizeKey(source);
  const targetTokens = tokenizeKey(target);
  const overlap = sourceTokens.filter((token) => targetTokens.includes(token)).length;
  if (overlap) return overlap * 20;
  return 0;
}

function suggestMapping(sourceColumns: string[], targetFields: string[]) {
  const next: Record<string, string> = {};
  const used = new Set<string>();
  for (const target of targetFields) {
    let best = "";
    let bestScore = 0;
    for (const source of sourceColumns) {
      if (used.has(source)) continue;
      const score = scoreColumnMatch(source, target);
      if (score > bestScore) {
        best = source;
        bestScore = score;
      }
    }
    if (best && bestScore >= 20) {
      next[target] = best;
      used.add(best);
    }
  }
  return next;
}


function makeTemplateLabel(template: MappingTemplate) {
  const scopeLabel = template.scope === "global" ? "global" : (template.branchCode || "default");
  const priorityLabel = `P${template.priority ?? 100}`;
  const fallbackLabel = template.fallback ? "fallback" : "direct";
  const vendorLabel = template.vendor ? ` • vendor:${template.vendor}` : "";
  const sheetLabel = template.workbookSheetName ? ` • sheet:${template.workbookSheetName}` : "";
  return `${template.name} • ${template.slug}/${template.datasetKey} • ${scopeLabel} • ${priorityLabel} • ${fallbackLabel}${vendorLabel}${sheetLabel}`;
}

function normalizeLooseText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9ก-๙]+/g, " ").trim();
}

function matchesFilePattern(fileName: string, pattern?: string) {
  if (!pattern) return false;
  const source = fileName.trim();
  if (!source) return false;
  try {
    const regex = new RegExp(pattern, "i");
    return regex.test(source);
  } catch {
    return normalizeLooseText(source).includes(normalizeLooseText(pattern));
  }
}

function getTemplateMatchScore(template: MappingTemplate, slug: string, datasetKey: string, branchCode: string, sourceColumns: string[], fileName = "", sheetName = "") {
  let score = 0;
  if (template.slug === slug) score += 90;
  if (template.datasetKey === datasetKey) score += 90;

  if ((template.scope || "branch") === "global") {
    score += 25;
  } else if ((template.branchCode || "default") === branchCode) {
    score += 60;
  } else {
    return -1;
  }

  const templateColumns = template.sourceColumns || Object.values(template.mapping || {});
  const overlap = templateColumns.filter((column) => sourceColumns.includes(column)).length;
  score += overlap * 8;

  if (template.vendor) {
    score += normalizeLooseText(fileName).includes(normalizeLooseText(template.vendor)) ? 35 : -10;
  }

  if (template.filePattern) {
    score += matchesFilePattern(fileName, template.filePattern) ? 45 : -8;
  }

  if (template.workbookSheetName) {
    score += normalizeLooseText(template.workbookSheetName) === normalizeLooseText(sheetName) ? 35 : -12;
  }

  if (template.appliesToSheets?.length) {
    score += template.appliesToSheets.some((item) => normalizeLooseText(item) === normalizeLooseText(sheetName)) ? 20 : -8;
  }

  score += template.fallback ? -15 : 10;
  score += Math.max(-50, Math.min(300, template.priority ?? 100));
  return score;
}

function getRankedTemplates(templates: MappingTemplate[], slug: string, datasetKey: string, branchCode: string, sourceColumns: string[], fileName = "", sheetName = "") {
  return templates
    .filter((template) => template.slug === slug && template.datasetKey === datasetKey)
    .map((template) => ({ template, score: getTemplateMatchScore(template, slug, datasetKey, branchCode, sourceColumns, fileName, sheetName) }))
    .filter((item) => item.score >= 130)
    .sort((a, b) => b.score - a.score);
}

function explainTemplateReason(template: MappingTemplate, fileName: string, sheetName: string) {
  const reasons: string[] = [];
  if ((template.scope || "branch") === "global") reasons.push("global");
  else reasons.push(`branch:${template.branchCode || "default"}`);
  if (template.vendor && normalizeLooseText(fileName).includes(normalizeLooseText(template.vendor))) reasons.push(`vendor:${template.vendor}`);
  if (template.filePattern && matchesFilePattern(fileName, template.filePattern)) reasons.push(`pattern:${template.filePattern}`);
  if (template.workbookSheetName && normalizeLooseText(template.workbookSheetName) === normalizeLooseText(sheetName)) reasons.push(`sheet:${template.workbookSheetName}`);
  if (template.priority !== undefined) reasons.push(`priority:${template.priority}`);
  if (template.fallback) reasons.push("fallback");
  return reasons.join(" • ");
}

function getBestTemplate(templates: MappingTemplate[], slug: string, datasetKey: string, branchCode: string, sourceColumns: string[], fileName = "", sheetName = "") {
  return getRankedTemplates(templates, slug, datasetKey, branchCode, sourceColumns, fileName, sheetName)[0]?.template || null;
}

function toTemplateSuggestions(templates: MappingTemplate[], slug: string, datasetKey: string, branchCode: string, sourceColumns: string[], fileName = "", sheetName = "") {
  return getRankedTemplates(templates, slug, datasetKey, branchCode, sourceColumns, fileName, sheetName)
    .slice(0, 3)
    .map(({ template, score }) => ({ templateId: template.id || "", score, reason: explainTemplateReason(template, fileName, sheetName) }));
}
function mapImportedRows({
  rows,
  mapping,
  includeUnmapped,
  trimBlankRows
}: {
  rows: Array<Record<string, unknown>>;
  mapping: Record<string, string>;
  includeUnmapped: boolean;
  trimBlankRows: boolean;
}) {
  const mapped = rows.map((row) => {
    const next: Record<string, unknown> = {};
    for (const [target, source] of Object.entries(mapping)) {
      if (!source) continue;
      next[target] = row[source];
    }
    if (includeUnmapped) {
      for (const [key, value] of Object.entries(row)) {
        if (!Object.values(mapping).includes(key)) {
          next[key] = value;
        }
      }
    }
    return next;
  });
  if (!trimBlankRows) return mapped;
  return mapped.filter((row) => Object.values(row).some((value) => String(value ?? "").trim() !== ""));
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h3 className="text-lg font-black text-slate-900">{title}</h3>
      {hint ? <p className="mt-1 text-sm text-slate-500">{hint}</p> : null}
    </div>
  );
}

function MultiBranchPicker({
  branches,
  selected,
  onToggle
}: {
  branches: Branch[];
  selected: string[];
  onToggle: (code: string) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {branches.map((branch) => {
        const active = selected.includes(branch.code);
        return (
          <button
            key={branch.code}
            onClick={() => onToggle(branch.code)}
            className={[
              "rounded-full border px-3 py-2 text-xs font-bold",
              active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-600"
            ].join(" ")}
          >
            {branch.name}
          </button>
        );
      })}
    </div>
  );
}

function DataTableEditor({
  label,
  rows,
  onChange
}: {
  label: string;
  rows: Array<Record<string, unknown>>;
  onChange: (rows: Array<Record<string, unknown>>) => void;
}) {
  const columns = getRowColumns(rows);

  function updateCell(index: number, column: string, value: string) {
    const next = rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [column]: fromEditableString(value) } : row));
    onChange(next);
  }

  function addRow() {
    const base = columns.length ? Object.fromEntries(columns.map((column) => [column, ""])) : { name: "" };
    onChange([...rows, base]);
  }

  function removeRow(index: number) {
    onChange(rows.filter((_, rowIndex) => rowIndex !== index));
  }

  function addColumn() {
    const name = window.prompt(`เพิ่ม column ใน ${label}`, "newField");
    if (!name) return;
    const next = rows.length ? rows.map((row) => ({ ...row, [name]: "" })) : [{ [name]: "" }];
    onChange(next);
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title={label} hint="แก้ข้อมูลตารางได้โดยตรง ไม่ต้องเปิด JSON" />
        <div className="flex gap-2">
          <button onClick={addColumn} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold">เพิ่มคอลัมน์</button>
          <button onClick={addRow} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white">เพิ่มแถว</button>
        </div>
      </div>
      <div className="mt-4 overflow-auto rounded-2xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900 text-white">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-3 py-2 text-left font-bold">{column}</th>
              ))}
              <th className="px-3 py-2 text-left font-bold">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t border-slate-100">
                {columns.map((column) => (
                  <td key={column} className="px-3 py-2 align-top">
                    <input
                      value={toEditableString(row[column])}
                      onChange={(event) => updateCell(index, column, event.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-2 py-2"
                    />
                  </td>
                ))}
                <td className="px-3 py-2">
                  <button onClick={() => removeRow(index)} className="rounded-lg border border-red-300 px-2 py-2 text-xs font-bold text-red-600">ลบ</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={Math.max(columns.length + 1, 1)} className="px-3 py-6 text-center text-slate-500">ยังไม่มีข้อมูล</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminConsole({
  initialSite,
  initialPages,
  initialUsers,
  initialLogs
}: {
  initialSite: SiteConfig;
  initialPages: PageDoc[];
  initialUsers: AppUser[];
  initialLogs: AuditEvent[];
}) {
  const { firebaseUser, profile } = useAuth();
  const searchParams = useSearchParams();
  const actor = firebaseUser ? { uid: firebaseUser.uid, email: firebaseUser.email } : undefined;
  const importRef = useRef<HTMLInputElement | null>(null);
  const datasetImportRef = useRef<HTMLInputElement | null>(null);
  const actorBranch = searchParams.get("branch") || initialSite.defaultBranchCode || initialSite.branches?.[0]?.code || "default";

  const [tab, setTab] = useState<"overview" | "pages" | "site" | "users" | "audit" | "io">("overview");
  const [site, setSite] = useState<SiteConfig>(initialSite);
  const [pages, setPages] = useState<PageDoc[]>(initialPages);
  const [users, setUsers] = useState<AppUser[]>(initialUsers);
  const [logs, setLogs] = useState<AuditEvent[]>(initialLogs);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selectedBranch, setSelectedBranch] = useState(actorBranch);
  const [selectedPageId, setSelectedPageId] = useState("");
  const [pageForm, setPageForm] = useState<PageDoc>({
    slug: "",
    title: "",
    type: "kpi_daily_monthly",
    data: {},
    branchCode: actorBranch,
    pageId: buildPageId("", actorBranch)
  });
  const [rawJson, setRawJson] = useState("{}");
  const [datasetImportKey, setDatasetImportKey] = useState("monthlyData");
  const [datasetImportMode, setDatasetImportMode] = useState<"replace" | "append">("replace");
  const [importWizard, setImportWizard] = useState<ImportWizardState | null>(null);
  const [mappingTemplates, setMappingTemplates] = useState<MappingTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  const branches = site.branches?.length ? site.branches : [{ code: "default", name: "สาขาหลัก", active: true }];
  const manageableBranches = profile?.role === "admin"
    ? branches
    : branches.filter((branch) => (profile?.allowedBranches || [actorBranch]).includes(branch.code));
  const branchPages = useMemo(
    () => pages.filter((page) => (page.branchCode || "default") === selectedBranch),
    [pages, selectedBranch]
  );

  useEffect(() => {
    const firstPage = branchPages[0];
    if (firstPage && !branchPages.some((page) => page.pageId === selectedPageId)) {
      syncPage(firstPage.pageId || buildPageId(firstPage.slug, firstPage.branchCode || selectedBranch), pages);
    }
  }, [branchPages]);

  useEffect(() => {
    refreshSideData().catch(() => undefined);
  }, []);

  function syncPage(pageId: string, sourcePages: PageDoc[] = pages) {
    const page = sourcePages.find((item) => (item.pageId || buildPageId(item.slug, item.branchCode || "default")) === pageId);
    if (!page) return;
    setSelectedPageId(pageId);
    setPageForm(page);
    setRawJson(pretty(page));
  }

  function clearAlerts() {
    setMessage("");
    setError("");
  }

  async function refreshSideData() {
    const [nextUsers, nextLogs, nextTemplates] = await Promise.all([getUsers(), getAuditLogs(100), getMappingTemplates()]);
    setUsers(nextUsers);
    setLogs(nextLogs);
    setMappingTemplates(nextTemplates);
  }

  function updateHeadline(key: string, value: string) {
    setPageForm((prev) => ({ ...prev, headline: { ...(prev.headline || {}), [key]: fromEditableString(value) } }));
  }

  function removeHeadline(key: string) {
    setPageForm((prev) => {
      const next = { ...(prev.headline || {}) };
      delete next[key];
      return { ...prev, headline: next };
    });
  }

  function updateDataField(key: string, value: unknown) {
    setPageForm((prev) => ({ ...prev, data: { ...prev.data, [key]: value } }));
  }

  function addHeadlineField() {
    const key = window.prompt("ชื่อ field headline", "newField");
    if (!key) return;
    updateHeadline(key, "");
  }

  function addDatasetField() {
    const key = window.prompt("ชื่อ dataset", "newDataset");
    if (!key) return;
    updateDataField(key, []);
    setDatasetImportKey(key);
  }

  async function onSaveSite() {
    clearAlerts();
    try {
      if (profile?.role !== "admin") throw new Error("มีเฉพาะ admin เท่านั้นที่แก้ Site / Branches ได้");
      const normalizedBranches = normalizeBranches(site.branches || []);
      const nextSite: SiteConfig = {
        ...site,
        branches: normalizedBranches,
        defaultBranchCode: site.defaultBranchCode || normalizedBranches[0]?.code || "default"
      };
      await saveSiteConfig(nextSite, actor);
      setSite(nextSite);
      setMessage("บันทึก site/settings สำเร็จ");
      await refreshSideData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึก site ไม่สำเร็จ");
    }
  }

  async function onSavePage() {
    clearAlerts();
    try {
      if (!pageForm.slug.trim()) throw new Error("slug ห้ามว่าง");
      if (!pageForm.title.trim()) throw new Error("title ห้ามว่าง");
      const branchCode = pageForm.branchCode || selectedBranch;
      if (profile?.role !== "admin" && !(profile?.allowedBranches || []).includes(branchCode)) {
        throw new Error("คุณไม่มีสิทธิ์แก้ข้อมูลสาขานี้");
      }
      const parsedPage: PageDoc = {
        ...pageForm,
        branchCode,
        pageId: buildPageId(pageForm.slug, branchCode)
      };
      await savePage(parsedPage, actor);
      const nextPages = [...pages.filter((page) => (page.pageId || buildPageId(page.slug, page.branchCode || "default")) !== selectedPageId), parsedPage]
        .sort((a, b) => `${a.branchCode}:${a.title}`.localeCompare(`${b.branchCode}:${b.title}`));
      setPages(nextPages);
      syncPage(parsedPage.pageId!, nextPages);
      setMessage(`บันทึก ${parsedPage.slug} ของสาขา ${branchCode} สำเร็จ`);
      await refreshSideData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึก page ไม่สำเร็จ");
    }
  }

  async function onDeletePage() {
    if (!selectedPageId) return;
    clearAlerts();
    try {
      const confirmed = window.confirm(`ลบหน้า ${selectedPageId} ?`);
      if (!confirmed) return;
      await deletePage(selectedPageId, actor);
      const nextPages = pages.filter((page) => (page.pageId || buildPageId(page.slug, page.branchCode || "default")) !== selectedPageId);
      setPages(nextPages);
      setMessage(`ลบ ${selectedPageId} สำเร็จ`);
      if (nextPages[0]) syncPage(nextPages[0].pageId || buildPageId(nextPages[0].slug, nextPages[0].branchCode || "default"), nextPages);
      await refreshSideData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ลบ page ไม่สำเร็จ");
    }
  }

  function onCreatePage() {
    clearAlerts();
    const empty: PageDoc = {
      slug: `new-page-${branchPages.length + 1}`,
      title: "หน้าใหม่",
      type: "custom",
      unit: "",
      icon: "",
      sourceFile: "",
      headline: {},
      data: {},
      branchCode: selectedBranch,
      pageId: buildPageId(`new-page-${branchPages.length + 1}`, selectedBranch)
    };
    setSelectedPageId("");
    setPageForm(empty);
    setRawJson(pretty(empty));
    setTab("pages");
  }

  async function onCloneBranch() {
    clearAlerts();
    try {
      const source = window.prompt("คัดลอกข้อมูลจาก branch ไหน", site.defaultBranchCode || "default");
      if (!source) return;
      if (profile?.role !== "admin" && !(profile?.allowedBranches || []).includes(selectedBranch)) {
        throw new Error("คุณไม่มีสิทธิ์ clone มายังสาขานี้");
      }
      await cloneBranchPages(source, selectedBranch, actor);
      const imported = await exportBundle();
      setPages(imported.pages);
      setMessage(`คัดลอกข้อมูลจาก ${source} ไป ${selectedBranch} สำเร็จ`);
      await refreshSideData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "คัดลอกสาขาไม่สำเร็จ");
    }
  }

  async function onChangeAccess(uid: string, role: Role, allowedBranches: string[]) {
    clearAlerts();
    try {
      if (profile?.role !== "admin") throw new Error("มีเฉพาะ admin เท่านั้นที่จัดการสิทธิ์ผู้ใช้ได้");
      await updateUserAccess(uid, role, allowedBranches, actor);
      setUsers((prev) => prev.map((user) => (user.uid === uid ? { ...user, role, allowedBranches } : user)));
      setMessage(`อัปเดตสิทธิ์ ${uid} เป็น ${role} สำเร็จ`);
      await refreshSideData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "อัปเดตสิทธิ์ไม่สำเร็จ");
    }
  }

  async function onExportBundle() {
    clearAlerts();
    try {
      const bundle = await exportBundle();
      downloadJson("bnak-dashboard-export.json", bundle);
      setMessage("Export ข้อมูลสำเร็จ");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export ไม่สำเร็จ");
    }
  }

  async function onImportFile(file: File) {
    clearAlerts();
    try {
      const text = await file.text();
      const parsed = safeParse<DataBundle>(text);
      if (!parsed.site || !Array.isArray(parsed.pages)) throw new Error("ไฟล์ import ไม่ถูกต้อง");
      await importBundle(parsed, actor);
      setSite(parsed.site);
      setPages(parsed.pages);
      setMessage(`Import สำเร็จ ${parsed.pages.length} หน้า`);
      await refreshSideData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import ไม่สำเร็จ");
    }
  }

  async function onImportDatasetFile(file: File) {
    clearAlerts();
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const rowsBySheet = Object.fromEntries(
        workbook.SheetNames.map((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Array<Record<string, unknown>>;
          return [sheetName, rows];
        })
      ) as Record<string, Array<Record<string, unknown>>>;
      const nonEmptySheets = workbook.SheetNames.filter((sheetName) => Array.isArray(rowsBySheet[sheetName]) && rowsBySheet[sheetName].length);
      if (!nonEmptySheets.length) throw new Error("ไม่พบตารางในไฟล์");
      const existing = Array.isArray(pageForm.data[datasetImportKey]) ? (pageForm.data[datasetImportKey] as Array<Record<string, unknown>>) : [];
      const targetFields = inferTargetFields(existing);

      const rankedSheets = nonEmptySheets
        .map((sheetName) => {
          const rows = rowsBySheet[sheetName] || [];
          const sourceColumns = getRowColumns(rows);
          const matchedTemplate = getBestTemplate(mappingTemplates, pageForm.slug, datasetImportKey, selectedBranch, sourceColumns, file.name, sheetName);
          const score = matchedTemplate ? getTemplateMatchScore(matchedTemplate, pageForm.slug, datasetImportKey, selectedBranch, sourceColumns, file.name, sheetName) : 0;
          return { sheetName, rows, sourceColumns, matchedTemplate, score };
        })
        .sort((a, b) => b.score - a.score || b.rows.length - a.rows.length);

      const best = rankedSheets[0];
      const matchedTemplate = best.matchedTemplate;
      setImportWizard({
        fileName: file.name,
        rowsBySheet,
        workbookSheetNames: workbook.SheetNames,
        selectedSheetName: best.sheetName,
        rows: best.rows,
        sourceColumns: best.sourceColumns,
        mapping: matchedTemplate?.mapping || suggestMapping(best.sourceColumns, targetFields),
        includeUnmapped: matchedTemplate?.includeUnmapped ?? (targetFields.length === 0),
        trimBlankRows: matchedTemplate?.trimBlankRows ?? true,
        templateId: matchedTemplate?.id,
        templateName: matchedTemplate?.name,
        templateScope: matchedTemplate?.scope || "branch",
        templatePriority: matchedTemplate?.priority ?? 100,
        templateFallback: matchedTemplate?.fallback ?? false,
        templateVendor: matchedTemplate?.vendor || "",
        templateFilePattern: matchedTemplate?.filePattern || "",
        templateSheetName: matchedTemplate?.workbookSheetName || best.sheetName,
        suggestedTemplates: toTemplateSuggestions(mappingTemplates, pageForm.slug, datasetImportKey, selectedBranch, best.sourceColumns, file.name, best.sheetName)
      });
      setSelectedTemplateId(matchedTemplate?.id || "");
      setMessage(matchedTemplate
        ? `เปิด mapping wizard สำหรับ ${file.name} แล้ว ระบบใช้ template ${matchedTemplate.name} ให้อัตโนมัติสำหรับ ${datasetImportKey} (sheet: ${best.sheetName})`
        : `เปิด mapping wizard สำหรับ ${file.name} แล้ว ตรวจ mapping ก่อนนำเข้า ${datasetImportKey} (sheet: ${best.sheetName})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import dataset ไม่สำเร็จ");
    }
  }

  function refreshImportSuggestions() {
    if (!importWizard) return;
    const existing = Array.isArray(pageForm.data[datasetImportKey]) ? (pageForm.data[datasetImportKey] as Array<Record<string, unknown>>) : [];
    const targetFields = inferTargetFields(existing);
    setImportWizard((prev) => prev ? { ...prev, mapping: suggestMapping(prev.sourceColumns, targetFields), templateId: undefined, templateName: undefined, suggestedTemplates: toTemplateSuggestions(mappingTemplates, pageForm.slug, datasetImportKey, selectedBranch, prev.sourceColumns, prev.fileName, prev.selectedSheetName) } : prev);
    setSelectedTemplateId("");
  }

  function onChangeImportSheet(sheetName: string) {
    if (!importWizard) return;
    const rows = importWizard.rowsBySheet[sheetName] || [];
    const sourceColumns = getRowColumns(rows);
    const existing = Array.isArray(pageForm.data[datasetImportKey]) ? (pageForm.data[datasetImportKey] as Array<Record<string, unknown>>) : [];
    const targetFields = inferTargetFields(existing);
    const matchedTemplate = getBestTemplate(mappingTemplates, pageForm.slug, datasetImportKey, selectedBranch, sourceColumns, importWizard.fileName, sheetName);
    setImportWizard((prev) => prev ? {
      ...prev,
      selectedSheetName: sheetName,
      rows,
      sourceColumns,
      mapping: matchedTemplate?.mapping || suggestMapping(sourceColumns, targetFields),
      includeUnmapped: matchedTemplate?.includeUnmapped ?? prev.includeUnmapped,
      trimBlankRows: matchedTemplate?.trimBlankRows ?? prev.trimBlankRows,
      templateId: matchedTemplate?.id,
      templateName: matchedTemplate?.name,
      templateScope: matchedTemplate?.scope || prev.templateScope,
      templatePriority: matchedTemplate?.priority ?? prev.templatePriority,
      templateFallback: matchedTemplate?.fallback ?? prev.templateFallback,
      templateVendor: matchedTemplate?.vendor || prev.templateVendor,
      templateFilePattern: matchedTemplate?.filePattern || prev.templateFilePattern,
      templateSheetName: matchedTemplate?.workbookSheetName || sheetName,
      suggestedTemplates: toTemplateSuggestions(mappingTemplates, pageForm.slug, datasetImportKey, selectedBranch, sourceColumns, prev.fileName, sheetName)
    } : prev);
    setSelectedTemplateId(matchedTemplate?.id || "");
  }

  function applyImportWizard() {
    clearAlerts();
    try {
      if (!importWizard) throw new Error("ยังไม่มีไฟล์ที่รอ import");
      const mappedRows = mapImportedRows({
        rows: importWizard.rows,
        mapping: importWizard.mapping,
        includeUnmapped: importWizard.includeUnmapped,
        trimBlankRows: importWizard.trimBlankRows
      });
      const existing = Array.isArray(pageForm.data[datasetImportKey]) ? (pageForm.data[datasetImportKey] as Array<Record<string, unknown>>) : [];
      const nextRows = datasetImportMode === "append" ? [...existing, ...mappedRows] : mappedRows;
      updateDataField(datasetImportKey, nextRows);
      setImportWizard(null);
      setMessage(`นำเข้า ${mappedRows.length} แถวเข้า ${datasetImportKey} สำเร็จ ยังไม่บันทึกลงฐานข้อมูล`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apply import wizard ไม่สำเร็จ");
    }
  }

  function applySelectedTemplate(templateId: string) {
    if (!importWizard) return;
    const template = mappingTemplates.find((item) => item.id === templateId);
    if (!template) return;
    setImportWizard((prev) => prev ? {
      ...prev,
      mapping: template.mapping,
      includeUnmapped: template.includeUnmapped ?? prev.includeUnmapped,
      trimBlankRows: template.trimBlankRows ?? prev.trimBlankRows,
      templateId: template.id,
      templateName: template.name,
      templateScope: template.scope || prev.templateScope,
      templatePriority: template.priority ?? prev.templatePriority,
      templateFallback: template.fallback ?? prev.templateFallback,
      templateVendor: template.vendor || prev.templateVendor,
      templateFilePattern: template.filePattern || prev.templateFilePattern,
      templateSheetName: template.workbookSheetName || prev.selectedSheetName,
      suggestedTemplates: prev.suggestedTemplates
    } : prev);
    setSelectedTemplateId(templateId);
    setMessage(`โหลด template ${template.name} เข้า wizard แล้ว`);
  }

  async function onSaveMappingTemplate() {
    clearAlerts();
    try {
      if (!importWizard) throw new Error("ยังไม่มี mapping wizard ที่จะบันทึก");
      const templateName = window.prompt("ชื่อ template mapping", importWizard.templateName || `${pageForm.slug}-${datasetImportKey}`)?.trim();
      if (!templateName) return;
      const existing = Array.isArray(pageForm.data[datasetImportKey]) ? (pageForm.data[datasetImportKey] as Array<Record<string, unknown>>) : [];
      const targetFields = inferTargetFields(existing);
      const templateId = await saveMappingTemplate({
        id: importWizard.templateId,
        name: templateName,
        slug: pageForm.slug,
        datasetKey: datasetImportKey,
        scope: importWizard.templateScope,
        branchCode: importWizard.templateScope === "global" ? "*" : selectedBranch,
        priority: importWizard.templatePriority,
        fallback: importWizard.templateFallback,
        vendor: importWizard.templateVendor,
        filePattern: importWizard.templateFilePattern,
        workbookSheetName: importWizard.templateSheetName || importWizard.selectedSheetName,
        appliesToSheets: importWizard.templateSheetName ? [importWizard.templateSheetName] : [importWizard.selectedSheetName],
        sourceColumns: importWizard.sourceColumns,
        targetFields,
        mapping: importWizard.mapping,
        includeUnmapped: importWizard.includeUnmapped,
        trimBlankRows: importWizard.trimBlankRows
      }, actor);
      const nextTemplates = await getMappingTemplates();
      setMappingTemplates(nextTemplates);
      setSelectedTemplateId(templateId);
      setImportWizard((prev) => prev ? { ...prev, templateId, templateName } : prev);
      setMessage(`บันทึก template ${templateName} สำเร็จ`);
      await refreshSideData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึก template ไม่สำเร็จ");
    }
  }

  async function onDeleteMappingTemplate(templateId: string) {
    clearAlerts();
    try {
      await deleteMappingTemplate(templateId, actor);
      const nextTemplates = await getMappingTemplates();
      setMappingTemplates(nextTemplates);
      if (selectedTemplateId === templateId) setSelectedTemplateId("");
      setImportWizard((prev) => prev?.templateId === templateId ? { ...prev, templateId: undefined, templateName: undefined } : prev);
      setMessage("ลบ mapping template สำเร็จ");
      await refreshSideData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ลบ mapping template ไม่สำเร็จ");
    }
  }

  function applyRawJson() {
    clearAlerts();
    try {
      const parsed = safeParse<PageDoc>(rawJson);
      setPageForm(parsed);
      setMessage("โหลดค่าจาก Advanced JSON สำเร็จ ยังไม่บันทึกลงฐานข้อมูล");
    } catch (e) {
      setError(e instanceof Error ? e.message : "JSON ไม่ถูกต้อง");
    }
  }

  const summaryCards = [
    { label: "Pages", value: pages.length.toString(), hint: "ทุกหน้า/ทุกสาขา" },
    { label: "Branches", value: branches.length.toString(), hint: "สาขาที่ตั้งค่าใช้งาน" },
    { label: "Users", value: users.length.toString(), hint: "บัญชีที่มี profile" },
    { label: "Editors", value: users.filter((u) => u.role === "admin" || u.role === "branch_admin").length.toString(), hint: "ผู้ดูแลและผู้ดูแลสาขา" }
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] bg-slate-900 p-6 text-white shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-yellow-300">Production Console</p>
        <h1 className="mt-2 text-3xl font-black">หลังบ้าน final deploy version</h1>
        <p className="mt-2 max-w-4xl text-sm text-slate-300">
          เวอร์ชันนี้เพิ่ม import Excel/CSV, สิทธิ์แยกระดับตามสาขา, และ field-level audit log เพื่อใช้จริงบนหลายสาขาในระบบเดียว
        </p>
      </div>

      {message && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{message}</div>}
      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="flex flex-wrap gap-2">
        {[
          ["overview", "Overview"],
          ["pages", "Pages"],
          ["site", "Site / Branches"],
          ["users", "Users"],
          ["audit", "Audit"],
          ["io", "Import / Export"]
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key as typeof tab)}
            className={[
              "rounded-full px-4 py-2 text-sm font-bold transition",
              tab === key ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <section className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map((card) => (
              <div key={card.label} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">{card.label}</p>
                <p className="mt-3 text-3xl font-black text-slate-900">{card.value}</p>
                <p className="mt-2 text-sm text-slate-500">{card.hint}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <SectionTitle title="สาขาที่เปิดใช้งาน" />
              <div className="mt-4 space-y-3">
                {branches.map((branch) => (
                  <div key={branch.code} className="rounded-2xl border border-slate-200 p-4">
                    <p className="font-bold text-slate-900">{branch.name}</p>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{branch.code}</p>
                    <p className="mt-2 text-sm text-slate-500">จำนวนหน้า: {pages.filter((page) => (page.branchCode || "default") === branch.code).length}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <SectionTitle title="ล่าสุดจาก Audit" />
              <div className="mt-4 space-y-3">
                {logs.slice(0, 8).map((log) => (
                  <div key={log.id} className="rounded-2xl border border-slate-200 p-4 text-sm">
                    <p className="font-bold text-slate-900">{log.summary}</p>
                    <p className="mt-1 text-slate-500">{log.action} • {log.actorEmail || log.actorUid}</p>
                    {Array.isArray(log.meta?.changedFields) ? (
                      <p className="mt-2 text-xs text-slate-500">field changes: {(log.meta?.changedFields as string[]).slice(0, 6).join(", ")}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {tab === "pages" && (
        <section className="space-y-6">
          <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-4">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <SectionTitle title="เลือกสาขา" hint="แต่ละสาขามีชุดหน้า KPI ของตัวเอง" />
                <select
                  value={selectedBranch}
                  onChange={(event) => {
                    setSelectedBranch(event.target.value);
                    const page = pages.find((item) => (item.branchCode || "default") === event.target.value);
                    if (page) syncPage(page.pageId || buildPageId(page.slug, page.branchCode || "default"));
                  }}
                  className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-3"
                >
                  {manageableBranches.map((branch) => (
                    <option key={branch.code} value={branch.code}>{branch.name}</option>
                  ))}
                </select>
                <div className="mt-3 flex gap-2">
                  <button onClick={onCreatePage} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white">เพิ่มหน้า</button>
                  <button onClick={onCloneBranch} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold">Clone จากต้นแบบ</button>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <SectionTitle title="หน้า KPI ในสาขานี้" />
                <div className="mt-4 space-y-2">
                  {branchPages.map((page) => {
                    const pageId = page.pageId || buildPageId(page.slug, page.branchCode || selectedBranch);
                    const active = selectedPageId === pageId;
                    return (
                      <button
                        key={pageId}
                        onClick={() => syncPage(pageId)}
                        className={[
                          "w-full rounded-2xl border px-3 py-3 text-left",
                          active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800"
                        ].join(" ")}
                      >
                        <p className="font-bold">{page.title}</p>
                        <p className={active ? "text-slate-300 text-xs" : "text-slate-400 text-xs"}>{page.slug}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <div>
                    <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">slug</label>
                    <input value={pageForm.slug} onChange={(e) => setPageForm((prev) => ({ ...prev, slug: e.target.value }))} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3" />
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">title</label>
                    <input value={pageForm.title} onChange={(e) => setPageForm((prev) => ({ ...prev, title: e.target.value }))} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3" />
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">type</label>
                    <input value={pageForm.type} onChange={(e) => setPageForm((prev) => ({ ...prev, type: e.target.value }))} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3" />
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">unit</label>
                    <input value={pageForm.unit || ""} onChange={(e) => setPageForm((prev) => ({ ...prev, unit: e.target.value }))} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3" />
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">source file</label>
                    <input value={pageForm.sourceFile || ""} onChange={(e) => setPageForm((prev) => ({ ...prev, sourceFile: e.target.value }))} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3" />
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">branch</label>
                    <select value={pageForm.branchCode || selectedBranch} onChange={(e) => setPageForm((prev) => ({ ...prev, branchCode: e.target.value }))} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3">
                      {manageableBranches.map((branch) => <option key={branch.code} value={branch.code}>{branch.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={onSavePage} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white">บันทึกหน้า</button>
                  <button onClick={onDeletePage} className="rounded-xl border border-red-300 px-4 py-3 text-sm font-bold text-red-600">ลบหน้า</button>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <SectionTitle title="Headline / Summary" hint="ค่าหลักที่ขึ้นการ์ดหรือหัวข้อบนหน้า KPI" />
                  <button onClick={addHeadlineField} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold">เพิ่ม field</button>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {Object.entries(pageForm.headline || {}).map(([key, value]) => (
                    <div key={key} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">{key}</p>
                        <button onClick={() => removeHeadline(key)} className="text-xs font-bold text-red-600">ลบ</button>
                      </div>
                      <input value={toEditableString(value)} onChange={(e) => updateHeadline(key, e.target.value)} className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-3" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <SectionTitle title="Import Excel / CSV เข้า dataset" hint="มี mapping wizard เลือกคอลัมน์อัตโนมัติและปรับเองได้ก่อนนำเข้า" />
                  <div className="flex flex-wrap gap-2">
                    <select value={datasetImportKey} onChange={(e) => setDatasetImportKey(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                      {inferDatasetKeys(pageForm.data).map((key) => <option key={key} value={key}>{key}</option>)}
                    </select>
                    <select value={datasetImportMode} onChange={(e) => setDatasetImportMode(e.target.value as typeof datasetImportMode)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                      <option value="replace">replace</option>
                      <option value="append">append</option>
                    </select>
                    <input
                      ref={datasetImportRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onImportDatasetFile(file);
                      }}
                    />
                    <button onClick={() => datasetImportRef.current?.click()} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white">เปิดไฟล์เข้า wizard</button>
                  </div>
                </div>

                {importWizard ? (() => {
                  const existing = Array.isArray(pageForm.data[datasetImportKey]) ? (pageForm.data[datasetImportKey] as Array<Record<string, unknown>>) : [];
                  const targetFields = inferTargetFields(existing);
                  const previewRows = mapImportedRows({
                    rows: importWizard.rows.slice(0, 5),
                    mapping: importWizard.mapping,
                    includeUnmapped: importWizard.includeUnmapped,
                    trimBlankRows: false
                  });
                  const previewColumns = getRowColumns(previewRows);
                  const currentTemplates = mappingTemplates.filter((template) => template.slug === pageForm.slug && template.datasetKey === datasetImportKey && (template.scope === "global" || (profile?.role === "admin") || manageableBranches.some((branch) => branch.code === (template.branchCode || "default"))));
                  return (
                    <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-700">Import Mapping Wizard</p>
                          <p className="mt-1 text-sm text-slate-700">ไฟล์ {importWizard.fileName} • {importWizard.rows.length} แถว • {importWizard.sourceColumns.length} คอลัมน์</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={refreshImportSuggestions} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold">จับคู่ให้อัตโนมัติอีกครั้ง</button>
                          <button onClick={() => setImportWizard(null)} className="rounded-xl border border-red-300 bg-white px-3 py-2 text-xs font-bold text-red-600">ยกเลิก</button>
                          <button onClick={applyImportWizard} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white">ยืนยันนำเข้า</button>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Workbook / Sheet</p>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <div>
                              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">เลือกชีตที่จะนำเข้า</p>
                              <select
                                value={importWizard.selectedSheetName}
                                onChange={(e) => onChangeImportSheet(e.target.value)}
                                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
                              >
                                {importWizard.workbookSheetNames.map((sheetName) => (
                                  <option key={sheetName} value={sheetName}>{sheetName}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Preset scope ที่กำลังจะบันทึก</p>
                              <select
                                value={importWizard.templateScope}
                                onChange={(e) => setImportWizard((prev) => prev ? { ...prev, templateScope: e.target.value as TemplateScope } : prev)}
                                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
                              >
                                <option value="branch">เฉพาะสาขานี้</option>
                                {profile?.role === "admin" ? <option value="global">ข้ามสาขา / ใช้ทั้งระบบ</option> : null}
                              </select>
                            </div>
                          </div>
                          <p className="mt-3 text-sm text-slate-500">รองรับหลาย sheet แล้ว เลือกชีตที่ต้องการก่อน map และสามารถบันทึก preset แยกตามชีตได้</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Source Columns</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {importWizard.sourceColumns.map((column) => (
                              <span key={column} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">{column}</span>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Target Fields ใน dataset นี้</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {targetFields.length ? targetFields.map((field) => (
                              <span key={field} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">{field}</span>
                            )) : <span className="text-sm text-slate-500">dataset นี้ยังไม่มี field เดิม ระบบจะเก็บชื่อคอลัมน์จาก Excel ตรง ๆ ได้</span>}
                          </div>
                        </div>
                      </div>



                      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-black text-slate-900">Template Mapping</p>
                            <p className="mt-1 text-xs text-slate-500">รองรับ template ข้ามสาขา, priority / fallback, หลาย sheet, preset ตาม vendor/รูปแบบไฟล์ และแนะนำ preset 1-3 อัตโนมัติ เหมาะกับสายฟรีเพราะ import ทำใน browser</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button onClick={onSaveMappingTemplate} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold">บันทึก template</button>
                            {selectedTemplateId ? <button onClick={() => onDeleteMappingTemplate(selectedTemplateId)} className="rounded-xl border border-red-300 bg-white px-3 py-2 text-xs font-bold text-red-600">ลบ template</button> : null}
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1.2fr)_auto]">
                          <select
                            value={selectedTemplateId}
                            onChange={(e) => {
                              setSelectedTemplateId(e.target.value);
                              if (e.target.value) applySelectedTemplate(e.target.value);
                            }}
                            className="rounded-xl border border-slate-300 px-3 py-3 text-sm"
                          >
                            <option value="">-- เลือก template ที่บันทึกไว้ --</option>
                            {currentTemplates.map((template) => <option key={template.id} value={template.id}>{makeTemplateLabel(template)}</option>)}
                          </select>
                          <button onClick={refreshImportSuggestions} className="rounded-xl border border-slate-300 px-3 py-3 text-xs font-bold">auto map ใหม่</button>
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <div>
                            <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Vendor / รูปแบบไฟล์</label>
                            <input value={importWizard.templateVendor} onChange={(e) => setImportWizard((prev) => prev ? { ...prev, templateVendor: e.target.value } : prev)} placeholder="เช่น DHL, Flash, Vendor-A" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm" />
                          </div>
                          <div>
                            <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">File pattern</label>
                            <input value={importWizard.templateFilePattern} onChange={(e) => setImportWizard((prev) => prev ? { ...prev, templateFilePattern: e.target.value } : prev)} placeholder="เช่น dhl.*daily หรือ Daily Report" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm" />
                          </div>
                          <div>
                            <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Priority</label>
                            <input type="number" value={importWizard.templatePriority} onChange={(e) => setImportWizard((prev) => prev ? { ...prev, templatePriority: Number(e.target.value || 0) } : prev)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm" />
                          </div>
                          <div>
                            <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Sheet preset</label>
                            <input value={importWizard.templateSheetName} onChange={(e) => setImportWizard((prev) => prev ? { ...prev, templateSheetName: e.target.value } : prev)} placeholder={importWizard.selectedSheetName} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm" />
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-600">
                          <label className="flex items-center gap-2"><input type="checkbox" checked={importWizard.templateFallback} onChange={(e) => setImportWizard((prev) => prev ? { ...prev, templateFallback: e.target.checked } : prev)} /> ใช้เป็น fallback template</label>
                        </div>
                        {importWizard.templateName ? <p className="mt-3 text-sm text-emerald-700">กำลังใช้ template: <span className="font-bold">{importWizard.templateName}</span></p> : null}
                        {!!importWizard.suggestedTemplates.length ? (
                          <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4">
                            <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-700">Suggested Presets 1-3</p>
                            <div className="mt-3 grid gap-3 md:grid-cols-3">
                              {importWizard.suggestedTemplates.map((suggestion, index) => {
                                const template = currentTemplates.find((item) => item.id === suggestion.templateId) || mappingTemplates.find((item) => item.id === suggestion.templateId);
                                if (!template) return null;
                                const active = importWizard.templateId === template.id;
                                return (
                                  <button
                                    key={suggestion.templateId || `${index}`}
                                    onClick={() => template.id && applySelectedTemplate(template.id)}
                                    className={[
                                      "rounded-2xl border p-3 text-left transition",
                                      active ? "border-sky-600 bg-white shadow-sm" : "border-sky-200 bg-white hover:border-sky-400"
                                    ].join(" ")}
                                  >
                                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-700">อันดับ {index + 1} • score {suggestion.score}</p>
                                    <p className="mt-2 text-sm font-black text-slate-900">{template.name}</p>
                                    <p className="mt-1 text-xs text-slate-500">{makeTemplateLabel(template)}</p>
                                    <p className="mt-2 text-xs text-slate-600">{suggestion.reason || "match by columns"}</p>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                        {!currentTemplates.length ? <p className="mt-3 text-sm text-slate-500">ยังไม่มี template ของ {pageForm.slug}/{datasetImportKey} ในสาขานี้หรือแบบ global บันทึกครั้งแรกได้เลย แล้วรอบถัดไประบบจะจับให้อัตโนมัติ</p> : null}
                      </div>

                      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-sm font-black text-slate-900">จับคู่คอลัมน์</p>
                          <div className="flex flex-wrap gap-4 text-sm text-slate-600">
                            <label className="flex items-center gap-2"><input type="checkbox" checked={importWizard.includeUnmapped} onChange={(e) => setImportWizard((prev) => prev ? { ...prev, includeUnmapped: e.target.checked } : prev)} /> เก็บคอลัมน์ที่ยังไม่ได้จับคู่ไว้ด้วย</label>
                            <label className="flex items-center gap-2"><input type="checkbox" checked={importWizard.trimBlankRows} onChange={(e) => setImportWizard((prev) => prev ? { ...prev, trimBlankRows: e.target.checked } : prev)} /> ตัดแถวว่างอัตโนมัติ</label>
                          </div>
                        </div>
                        <div className="mt-4 space-y-3">
                          {Array.from(new Set([...(targetFields.length ? targetFields : []), ...Object.keys(importWizard.mapping), ...(targetFields.length ? [] : importWizard.sourceColumns)])).map((target) => (
                            <div key={target} className="grid gap-3 rounded-2xl border border-slate-200 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                              <div>
                                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">field ปลายทาง</p>
                                <input
                                  value={target}
                                  onChange={(e) => {
                                    const nextTarget = e.target.value;
                                    setImportWizard((prev) => {
                                      if (!prev) return prev;
                                      const nextMapping = { ...prev.mapping };
                                      const currentSource = nextMapping[target] || "";
                                      delete nextMapping[target];
                                      nextMapping[nextTarget] = currentSource;
                                      return { ...prev, mapping: nextMapping };
                                    });
                                  }}
                                  className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2"
                                />
                              </div>
                              <div>
                                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">คอลัมน์จากไฟล์</p>
                                <select
                                  value={importWizard.mapping[target] || ""}
                                  onChange={(e) => setImportWizard((prev) => prev ? { ...prev, mapping: { ...prev.mapping, [target]: e.target.value } } : prev)}
                                  className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2"
                                >
                                  <option value="">-- ไม่ใช้ --</option>
                                  {importWizard.sourceColumns.map((column) => <option key={column} value={column}>{column}</option>)}
                                </select>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                        <p className="text-sm font-black text-slate-900">Preview หลัง map</p>
                        <div className="mt-3 overflow-auto rounded-2xl border border-slate-200">
                          <table className="min-w-full text-sm">
                            <thead className="bg-slate-900 text-white">
                              <tr>
                                {previewColumns.map((column) => <th key={column} className="px-3 py-2 text-left font-bold">{column}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {previewRows.map((row, index) => (
                                <tr key={index} className="border-t border-slate-100">
                                  {previewColumns.map((column) => <td key={column} className="px-3 py-2">{toEditableString(row[column])}</td>)}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  );
                })() : null}
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <SectionTitle title="Datasets" hint="ตาราง monthly/daily/detail ของ KPI แต่ละหน้า" />
                  <button onClick={addDatasetField} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold">เพิ่ม dataset</button>
                </div>
                {inferDatasetKeys(pageForm.data).map((key) => {
                  const value = pageForm.data[key];
                  if (Array.isArray(value)) {
                    return <DataTableEditor key={key} label={key} rows={value as Array<Record<string, unknown>>} onChange={(rows) => updateDataField(key, rows)} />;
                  }
                  return (
                    <div key={key} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <SectionTitle title={key} hint="ค่าที่ไม่ใช่ตารางจะเก็บแบบข้อความหรือ JSON ย่อย" />
                        <button onClick={() => {
                          const next = { ...pageForm.data };
                          delete next[key];
                          setPageForm((prev) => ({ ...prev, data: next }));
                        }} className="text-xs font-bold text-red-600">ลบ field</button>
                      </div>
                      <textarea value={typeof value === "string" ? value : pretty(value)} onChange={(e) => updateDataField(key, fromEditableString(e.target.value))} className="mt-4 min-h-[140px] w-full rounded-2xl border border-slate-300 px-4 py-3 font-mono text-sm" />
                    </div>
                  );
                })}
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <SectionTitle title="Advanced JSON" hint="ใช้เฉพาะกรณีต้องย้ายโครงข้อมูลเร็ว ๆ" />
                  <button onClick={() => setRawJson(pretty(pageForm))} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold">รีเฟรชจากฟอร์ม</button>
                </div>
                <textarea value={rawJson} onChange={(e) => setRawJson(e.target.value)} className="mt-4 min-h-[240px] w-full rounded-2xl border border-slate-300 px-4 py-3 font-mono text-sm" />
                <button onClick={applyRawJson} className="mt-3 rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold">โหลด JSON เข้าฟอร์ม</button>
              </div>
            </div>
          </div>
        </section>
      )}

      {tab === "site" && (
        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <SectionTitle title="Brand / Theme" />
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">App Name</label>
                <input value={site.appName} onChange={(e) => setSite((prev) => ({ ...prev, appName: e.target.value }))} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3" disabled={profile?.role !== "admin"} />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Brand</label>
                <input value={site.brand} onChange={(e) => setSite((prev) => ({ ...prev, brand: e.target.value }))} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3" disabled={profile?.role !== "admin"} />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Primary</label>
                <input value={site.theme.primary} onChange={(e) => setSite((prev) => ({ ...prev, theme: { ...prev.theme, primary: e.target.value } }))} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3" disabled={profile?.role !== "admin"} />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Dark</label>
                <input value={site.theme.dark} onChange={(e) => setSite((prev) => ({ ...prev, theme: { ...prev.theme, dark: e.target.value } }))} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3" disabled={profile?.role !== "admin"} />
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <SectionTitle title="Branches" hint="เพิ่มสาขาใหม่เพื่อให้หลายคลัง/หลายศูนย์ใช้ระบบเดียวกันได้" />
              {profile?.role === "admin" ? <button onClick={() => setSite((prev) => ({ ...prev, branches: [...(prev.branches || []), { code: `branch-${(prev.branches || []).length + 1}`, name: "สาขาใหม่", active: true }] }))} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold">เพิ่มสาขา</button> : null}
            </div>
            <div className="mt-4 space-y-3">
              {(site.branches || []).map((branch, index) => (
                <div key={branch.code + index} className="grid gap-3 rounded-2xl border border-slate-200 p-4 md:grid-cols-2 xl:grid-cols-4">
                  <input value={branch.code} onChange={(e) => setSite((prev) => ({ ...prev, branches: (prev.branches || []).map((item, i) => i === index ? { ...item, code: e.target.value } : item) }))} className="rounded-xl border border-slate-300 px-3 py-3" placeholder="code" disabled={profile?.role !== "admin"} />
                  <input value={branch.name} onChange={(e) => setSite((prev) => ({ ...prev, branches: (prev.branches || []).map((item, i) => i === index ? { ...item, name: e.target.value } : item) }))} className="rounded-xl border border-slate-300 px-3 py-3" placeholder="name" disabled={profile?.role !== "admin"} />
                  <input value={branch.area || ""} onChange={(e) => setSite((prev) => ({ ...prev, branches: (prev.branches || []).map((item, i) => i === index ? { ...item, area: e.target.value } : item) }))} className="rounded-xl border border-slate-300 px-3 py-3" placeholder="area" disabled={profile?.role !== "admin"} />
                  <div className="flex gap-2">
                    <select value={branch.active === false ? "inactive" : "active"} onChange={(e) => setSite((prev) => ({ ...prev, branches: (prev.branches || []).map((item, i) => i === index ? { ...item, active: e.target.value === "active" } : item) }))} className="flex-1 rounded-xl border border-slate-300 px-3 py-3" disabled={profile?.role !== "admin"}>
                      <option value="active">active</option>
                      <option value="inactive">inactive</option>
                    </select>
                    {profile?.role === "admin" ? <button onClick={() => setSite((prev) => ({ ...prev, branches: (prev.branches || []).filter((_, i) => i !== index) }))} className="rounded-xl border border-red-300 px-3 py-3 text-xs font-bold text-red-600">ลบ</button> : null}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Default Branch</label>
              <select value={site.defaultBranchCode || "default"} onChange={(e) => setSite((prev) => ({ ...prev, defaultBranchCode: e.target.value }))} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3" disabled={profile?.role !== "admin"}>
                {(site.branches || []).map((branch) => <option key={branch.code} value={branch.code}>{branch.name}</option>)}
              </select>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <SectionTitle title="Navigation" hint="เมนูที่แสดงในแอป" />
              {profile?.role === "admin" ? <button onClick={() => setSite((prev) => ({ ...prev, nav: [...prev.nav, { slug: "new-page", label: "เมนูใหม่", group: "ทั่วไป" }] }))} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold">เพิ่มเมนู</button> : null}
            </div>
            <div className="mt-4 space-y-3">
              {site.nav.map((item, index) => (
                <div key={item.slug + index} className="grid gap-3 rounded-2xl border border-slate-200 p-4 md:grid-cols-3 xl:grid-cols-4">
                  <input value={item.slug} onChange={(e) => setSite((prev) => ({ ...prev, nav: prev.nav.map((nav, i) => i === index ? { ...nav, slug: e.target.value } : nav) }))} className="rounded-xl border border-slate-300 px-3 py-3" placeholder="slug" disabled={profile?.role !== "admin"} />
                  <input value={item.label} onChange={(e) => setSite((prev) => ({ ...prev, nav: prev.nav.map((nav, i) => i === index ? { ...nav, label: e.target.value } : nav) }))} className="rounded-xl border border-slate-300 px-3 py-3" placeholder="label" disabled={profile?.role !== "admin"} />
                  <input value={item.group} onChange={(e) => setSite((prev) => ({ ...prev, nav: prev.nav.map((nav, i) => i === index ? { ...nav, group: e.target.value } : nav) }))} className="rounded-xl border border-slate-300 px-3 py-3" placeholder="group" disabled={profile?.role !== "admin"} />
                  {profile?.role === "admin" ? <button onClick={() => setSite((prev) => ({ ...prev, nav: prev.nav.filter((_, i) => i !== index) }))} className="rounded-xl border border-red-300 px-3 py-3 text-xs font-bold text-red-600">ลบเมนู</button> : null}
                </div>
              ))}
            </div>
            {profile?.role === "admin" ? <button onClick={onSaveSite} className="mt-4 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white">บันทึก Site / Branches</button> : <p className="mt-4 text-sm text-slate-500">branch_admin ดูโครงสร้างได้ แต่แก้ Site / Branches ไม่ได้</p>}
          </div>
        </section>
      )}

      {tab === "users" && (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <SectionTitle title="Users & Roles" hint="กำหนดระดับสิทธิ์และสาขาที่เข้าได้" />
          {profile?.role !== "admin" ? <p className="mt-4 text-sm text-slate-500">มีเฉพาะ admin เท่านั้นที่จัดการสิทธิ์ผู้ใช้ได้</p> : null}
          <div className="mt-4 space-y-4">
            {users.map((user) => {
              const allowed = user.allowedBranches?.length ? user.allowedBranches : [site.defaultBranchCode || "default"];
              return (
                <div key={user.uid} className="rounded-2xl border border-slate-200 p-4">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                    <div>
                      <p className="font-bold text-slate-900">{user.email || "-"}</p>
                      <p className="mt-1 text-xs text-slate-500">{user.uid}</p>
                    </div>
                    <div>
                      <select
                        value={user.role}
                        disabled={profile?.role !== "admin"}
                        onChange={(e) => onChangeAccess(user.uid, e.target.value as Role, allowed)}
                        className="w-full rounded-xl border border-slate-300 px-3 py-3"
                      >
                        <option value="user">user</option>
                        <option value="branch_admin">branch_admin</option>
                        <option value="admin">admin</option>
                      </select>
                    </div>
                  </div>
                  <div className="mt-3">
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">allowed branches</p>
                    <MultiBranchPicker
                      branches={branches}
                      selected={allowed}
                      onToggle={(code) => {
                        if (profile?.role !== "admin") return;
                        const next = allowed.includes(code) ? allowed.filter((item) => item !== code) : [...allowed, code];
                        onChangeAccess(user.uid, user.role, next);
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {tab === "audit" && (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <SectionTitle title="Audit Logs" hint="แสดง field ที่ถูกแก้เพื่อไล่ตรวจย้อนหลังได้ง่ายขึ้น" />
          <div className="mt-4 space-y-3">
            {logs.map((log) => (
              <div key={log.id} className="rounded-2xl border border-slate-200 p-4 text-sm">
                <p className="font-bold text-slate-900">{log.summary}</p>
                <p className="mt-1 text-slate-500">{log.action} • {log.entityType}/{log.entityId} • {log.actorEmail || log.actorUid}</p>
                {log.meta ? <pre className="mt-3 overflow-auto rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{pretty(log.meta)}</pre> : null}
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "io" && (
        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <SectionTitle title="Export" hint="สำรองข้อมูลทุกสาขาเป็น JSON" />
            <button onClick={onExportBundle} className="mt-4 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white">Export Bundle</button>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <SectionTitle title="Import" hint="restore ข้อมูลกลับเข้า Firestore" />
            <input ref={importRef} type="file" accept="application/json" className="mt-4 block w-full text-sm" onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImportFile(file);
            }} />
          </div>
        </section>
      )}
    </div>
  );
}
