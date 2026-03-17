"use client";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from "firebase/firestore";
import { db } from "./firebase-client";
import type { PageDoc, SiteConfig, AppUser, AuditEvent, DataBundle, Role, MappingTemplate } from "./types";

export type AuditActor = {
  uid: string;
  email: string | null;
};

export function buildPageId(slug: string, branchCode = "default") {
  const normalizedSlug = slug.trim();
  const normalizedBranch = branchCode.trim() || "default";
  return `${normalizedBranch}__${normalizedSlug}`;
}

function normalizePageDoc(data: Record<string, unknown>, fallbackId?: string): PageDoc {
  const raw = data as PageDoc;
  const pageId = (raw.pageId || fallbackId || buildPageId(raw.slug, raw.branchCode || "default")) as string;
  return {
    ...raw,
    branchCode: raw.branchCode || String(pageId).split("__")[0] || "default",
    pageId
  };
}

function normalizeUser(data: Record<string, unknown>): AppUser {
  const raw = data as AppUser;
  return {
    ...raw,
    role: raw.role || "user",
    allowedBranches: Array.isArray(raw.allowedBranches) && raw.allowedBranches.length ? raw.allowedBranches : ["default"]
  };
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneClean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function collectDiffPaths(before: unknown, after: unknown, base = ""): string[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];

  if (Array.isArray(before) || Array.isArray(after)) {
    return [base || "root"];
  }

  if (isObjectLike(before) && isObjectLike(after)) {
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
    const nested = keys.flatMap((key) => collectDiffPaths(before[key], after[key], base ? `${base}.${key}` : key));
    return nested.length ? nested : [base || "root"];
  }

  return [base || "root"];
}

async function logAudit(event: Omit<AuditEvent, "createdAt">) {
  await addDoc(collection(db, "audit_logs"), {
    ...event,
    createdAt: serverTimestamp()
  });
}

export async function getSiteConfig(): Promise<SiteConfig> {
  const snapshot = await getDoc(doc(db, "site", "settings"));
  const site = snapshot.data() as SiteConfig;
  return {
    ...site,
    branches: site?.branches?.length
      ? site.branches
      : [{ code: "default", name: "สาขาหลัก", area: "ส่วนกลาง", active: true }],
    defaultBranchCode: site?.defaultBranchCode || site?.branches?.[0]?.code || "default"
  };
}

export async function getPages(): Promise<PageDoc[]> {
  const snapshot = await getDocs(collection(db, "pages"));
  return snapshot.docs
    .map((d) => normalizePageDoc(d.data() as Record<string, unknown>, d.id))
    .sort((a, b) => `${a.branchCode}:${a.title}`.localeCompare(`${b.branchCode}:${b.title}`));
}

export async function getPage(slug: string, branchCode = "default"): Promise<PageDoc | null> {
  const candidates = [buildPageId(slug, branchCode), buildPageId(slug, "default"), slug];
  for (const candidate of candidates) {
    const snapshot = await getDoc(doc(db, "pages", candidate));
    if (snapshot.exists()) {
      return normalizePageDoc(snapshot.data() as Record<string, unknown>, snapshot.id);
    }
  }
  return null;
}

export async function savePage(page: PageDoc, actor?: AuditActor) {
  const branchCode = page.branchCode?.trim() || "default";
  const pageId = buildPageId(page.slug, branchCode);
  const ref = doc(db, "pages", pageId);
  const existing = await getDoc(ref);
  const before = existing.exists() ? cloneClean(existing.data()) : null;
  const payload = {
    ...page,
    branchCode,
    pageId,
    updatedAt: serverTimestamp()
  };
  await setDoc(ref, payload, { merge: true });

  if (page.pageId && page.pageId !== pageId) {
    await deleteDoc(doc(db, "pages", page.pageId));
  }

  if (actor) {
    const changedFields = collectDiffPaths(before, { ...page, branchCode, pageId }).filter((value, index, arr) => arr.indexOf(value) === index).slice(0, 100);
    await logAudit({
      action: "page.save",
      entityType: "page",
      entityId: pageId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      summary: `Updated page ${page.slug} for branch ${branchCode}`,
      meta: { slug: page.slug, branchCode, changedFields, changeCount: changedFields.length }
    });
  }
}

export async function deletePage(pageId: string, actor?: AuditActor) {
  await deleteDoc(doc(db, "pages", pageId));

  if (actor) {
    await logAudit({
      action: "page.delete",
      entityType: "page",
      entityId: pageId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      summary: `Deleted page ${pageId}`
    });
  }
}

export async function cloneBranchPages(sourceBranchCode: string, targetBranchCode: string, actor?: AuditActor) {
  const pages = await getPages();
  const sourcePages = pages.filter((page) => (page.branchCode || "default") === sourceBranchCode);
  const batch = writeBatch(db);
  for (const page of sourcePages) {
    const cloned: PageDoc = {
      ...page,
      branchCode: targetBranchCode,
      pageId: buildPageId(page.slug, targetBranchCode)
    };
    batch.set(doc(db, "pages", cloned.pageId), { ...cloned, updatedAt: serverTimestamp() }, { merge: true });
  }
  await batch.commit();

  if (actor) {
    await logAudit({
      action: "branch.clone",
      entityType: "bundle",
      entityId: `${sourceBranchCode}->${targetBranchCode}`,
      actorUid: actor.uid,
      actorEmail: actor.email,
      summary: `Cloned ${sourcePages.length} pages from ${sourceBranchCode} to ${targetBranchCode}`,
      meta: { sourceBranchCode, targetBranchCode, pageCount: sourcePages.length }
    });
  }
}

export async function saveSiteConfig(site: SiteConfig, actor?: AuditActor) {
  const ref = doc(db, "site", "settings");
  const existing = await getDoc(ref);
  const before = existing.exists() ? cloneClean(existing.data()) : null;
  const normalized = {
    ...site,
    defaultBranchCode: site.defaultBranchCode || site.branches?.[0]?.code || "default",
    branches: site.branches?.length ? site.branches : [{ code: "default", name: "สาขาหลัก", active: true }],
    updatedAt: serverTimestamp()
  };
  await setDoc(ref, normalized, { merge: true });

  if (actor) {
    const changedFields = collectDiffPaths(before, { ...site, defaultBranchCode: site.defaultBranchCode || site.branches?.[0]?.code || "default" }).filter((value, index, arr) => arr.indexOf(value) === index).slice(0, 100);
    await logAudit({
      action: "site.save",
      entityType: "site",
      entityId: "settings",
      actorUid: actor.uid,
      actorEmail: actor.email,
      summary: "Updated site settings",
      meta: { changedFields, changeCount: changedFields.length }
    });
  }
}

export async function getUserProfile(uid: string): Promise<AppUser | null> {
  const snapshot = await getDoc(doc(db, "users", uid));
  return snapshot.exists() ? normalizeUser(snapshot.data() as Record<string, unknown>) : null;
}

export async function upsertUserProfile(user: AppUser) {
  await setDoc(
    doc(db, "users", user.uid),
    {
      ...user,
      role: user.role || "user",
      allowedBranches: user.allowedBranches?.length ? user.allowedBranches : ["default"],
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

export async function getUsers(): Promise<AppUser[]> {
  const snapshot = await getDocs(collection(db, "users"));
  return snapshot.docs
    .map((d) => normalizeUser(d.data() as Record<string, unknown>))
    .sort((a, b) => (a.email || "").localeCompare(b.email || ""));
}

export async function updateUserAccess(uid: string, role: Role, allowedBranches: string[], actor?: AuditActor) {
  const ref = doc(db, "users", uid);
  const existing = await getDoc(ref);
  const before = existing.exists() ? cloneClean(existing.data()) : null;
  const payload = { role, allowedBranches: allowedBranches.length ? allowedBranches : ["default"], updatedAt: serverTimestamp() };
  await updateDoc(ref, payload);

  if (actor) {
    const changedFields = collectDiffPaths(before, { ...(before || {}), role, allowedBranches }).filter((value, index, arr) => arr.indexOf(value) === index).slice(0, 100);
    await logAudit({
      action: "user.access.update",
      entityType: "user",
      entityId: uid,
      actorUid: actor.uid,
      actorEmail: actor.email,
      summary: `Changed access for ${uid} to ${role}`,
      meta: { role, allowedBranches, changedFields, changeCount: changedFields.length }
    });
  }
}

export async function getAuditLogs(max = 50): Promise<AuditEvent[]> {
  const snapshot = await getDocs(query(collection(db, "audit_logs"), orderBy("createdAt", "desc"), limit(max)));
  return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as AuditEvent) }));
}



function normalizeTemplate(data: Record<string, unknown>, fallbackId?: string): MappingTemplate {
  const raw = data as MappingTemplate;
  const normalizedScope = raw.scope || ((raw.branchCode || "default") === "*" ? "global" : "branch");
  return {
    ...raw,
    id: raw.id || fallbackId,
    scope: normalizedScope,
    branchCode: normalizedScope === "global" ? "*" : (raw.branchCode || "default"),
    priority: typeof raw.priority === "number" ? raw.priority : 100,
    fallback: raw.fallback ?? false,
    vendor: raw.vendor || "",
    filePattern: raw.filePattern || "",
    workbookSheetName: raw.workbookSheetName || "",
    appliesToSheets: Array.isArray(raw.appliesToSheets) ? raw.appliesToSheets : [],
    includeUnmapped: raw.includeUnmapped ?? false,
    trimBlankRows: raw.trimBlankRows ?? true,
    sourceColumns: Array.isArray(raw.sourceColumns) ? raw.sourceColumns : [],
    targetFields: Array.isArray(raw.targetFields) ? raw.targetFields : []
  };
}

export async function getMappingTemplates(): Promise<MappingTemplate[]> {
  const snapshot = await getDocs(collection(db, "mapping_templates"));
  return snapshot.docs
    .map((d) => normalizeTemplate(d.data() as Record<string, unknown>, d.id))
    .sort((a, b) => `${a.slug}:${a.datasetKey}:${a.name}`.localeCompare(`${b.slug}:${b.datasetKey}:${b.name}`));
}

export async function saveMappingTemplate(template: MappingTemplate, actor?: AuditActor) {
  const ref = template.id ? doc(db, "mapping_templates", template.id) : doc(collection(db, "mapping_templates"));
  const existing = template.id ? await getDoc(ref) : null;
  const before = existing?.exists() ? cloneClean(existing.data()) : null;
  const scope = template.scope || (template.branchCode === "*" ? "global" : "branch");
  const normalizedBranchCode = scope === "global" ? "*" : (template.branchCode || "default");
  const payload = {
    ...template,
    id: ref.id,
    scope,
    branchCode: normalizedBranchCode,
    priority: typeof template.priority === "number" ? template.priority : 100,
    fallback: template.fallback ?? false,
    vendor: template.vendor || "",
    filePattern: template.filePattern || "",
    workbookSheetName: template.workbookSheetName || "",
    appliesToSheets: template.appliesToSheets || [],
    sourceColumns: template.sourceColumns || [],
    targetFields: template.targetFields || [],
    includeUnmapped: template.includeUnmapped ?? false,
    trimBlankRows: template.trimBlankRows ?? true,
    updatedAt: serverTimestamp()
  };
  await setDoc(ref, payload, { merge: true });

  if (actor) {
    const changedFields = collectDiffPaths(before, { ...payload, updatedAt: undefined }).filter((value, index, arr) => arr.indexOf(value) === index).slice(0, 100);
    await logAudit({
      action: "mapping_template.save",
      entityType: "bundle",
      entityId: ref.id,
      actorUid: actor.uid,
      actorEmail: actor.email,
      summary: `Saved mapping template ${template.name} for ${template.slug}/${template.datasetKey}`,
      meta: {
        slug: template.slug,
        datasetKey: template.datasetKey,
        branchCode: normalizedBranchCode,
        scope,
        priority: payload.priority,
        fallback: payload.fallback,
        vendor: payload.vendor,
        filePattern: payload.filePattern,
        workbookSheetName: payload.workbookSheetName,
        changedFields,
        changeCount: changedFields.length
      }
    });
  }

  return ref.id;
}

export async function deleteMappingTemplate(templateId: string, actor?: AuditActor) {
  await deleteDoc(doc(db, "mapping_templates", templateId));
  if (actor) {
    await logAudit({
      action: "mapping_template.delete",
      entityType: "bundle",
      entityId: templateId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      summary: `Deleted mapping template ${templateId}`
    });
  }
}

export async function exportBundle(): Promise<DataBundle> {
  const [site, pages, mappingTemplates] = await Promise.all([getSiteConfig(), getPages(), getMappingTemplates()]);
  return { site, pages, mappingTemplates };
}

export async function importBundle(bundle: DataBundle, actor?: AuditActor) {
  const batch = writeBatch(db);
  batch.set(doc(db, "site", "settings"), { ...bundle.site, updatedAt: serverTimestamp() }, { merge: true });
  for (const page of bundle.pages) {
    const pageId = buildPageId(page.slug, page.branchCode || "default");
    batch.set(doc(db, "pages", pageId), { ...page, pageId, branchCode: page.branchCode || "default", updatedAt: serverTimestamp() }, { merge: true });
  }
  for (const template of bundle.mappingTemplates || []) {
    const templateRef = template.id ? doc(db, "mapping_templates", template.id) : doc(collection(db, "mapping_templates"));
    batch.set(templateRef, { ...template, id: templateRef.id, updatedAt: serverTimestamp() }, { merge: true });
  }
  await batch.commit();

  if (actor) {
    await logAudit({
      action: "bundle.import",
      entityType: "bundle",
      entityId: "full-import",
      actorUid: actor.uid,
      actorEmail: actor.email,
      summary: `Imported bundle with ${bundle.pages.length} pages`,
      meta: { pageCount: bundle.pages.length, mappingTemplateCount: (bundle.mappingTemplates || []).length, branchCodes: Array.from(new Set(bundle.pages.map((page) => page.branchCode || "default"))).sort() }
    });
  }
}
