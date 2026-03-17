export type Role = "admin" | "branch_admin" | "user";

export type AppUser = {
  uid: string;
  email: string | null;
  role: Role;
  displayName?: string | null;
  allowedBranches?: string[];
  updatedAt?: unknown;
};

export type Branch = {
  code: string;
  name: string;
  area?: string;
  warehouse?: string;
  active?: boolean;
  notes?: string;
};

export type NavItem = {
  slug: string;
  label: string;
  group: string;
};

export type SiteConfig = {
  appName: string;
  brand: string;
  theme: { primary: string; dark: string };
  nav: NavItem[];
  branches?: Branch[];
  defaultBranchCode?: string;
  updatedAt?: unknown;
};

export type PageDoc = {
  slug: string;
  title: string;
  type: string;
  unit?: string;
  icon?: string;
  sourceFile?: string;
  headline?: Record<string, unknown>;
  data: Record<string, unknown>;
  branchCode?: string;
  pageId?: string;
  updatedAt?: unknown;
};

export type AuditEvent = {
  id?: string;
  action: string;
  entityType: "site" | "page" | "user" | "bundle";
  entityId: string;
  actorUid: string;
  actorEmail: string | null;
  summary: string;
  createdAt?: unknown;
  meta?: Record<string, unknown>;
};

export type DataBundle = {
  site: SiteConfig;
  pages: PageDoc[];
  mappingTemplates?: MappingTemplate[];
};

export type TemplateScope = "branch" | "global";

export type MappingTemplate = {
  id?: string;
  name: string;
  slug: string;
  datasetKey: string;
  branchCode?: string;
  scope?: TemplateScope;
  priority?: number;
  fallback?: boolean;
  vendor?: string;
  filePattern?: string;
  workbookSheetName?: string;
  appliesToSheets?: string[];
  sourceColumns?: string[];
  targetFields?: string[];
  mapping: Record<string, string>;
  includeUnmapped?: boolean;
  trimBlankRows?: boolean;
  updatedAt?: unknown;
};


export type TemplateSuggestion = {
  templateId: string;
  score: number;
  reason: string;
};
