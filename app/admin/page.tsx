"use client";

import { useEffect, useState } from "react";
import { AdminConsole } from "@/components/admin-console";
import { AppShell } from "@/components/app-shell";
import { RequireAuth } from "@/components/require-auth";
import { getAuditLogs, getPages, getSiteConfig, getUsers } from "@/lib/firestore";
import type { AuditEvent, AppUser, PageDoc, SiteConfig } from "@/lib/types";

export default function AdminPage() {
  const [site, setSite] = useState<SiteConfig | null>(null);
  const [pages, setPages] = useState<PageDoc[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [logs, setLogs] = useState<AuditEvent[]>([]);

  useEffect(() => {
    Promise.all([getSiteConfig(), getPages(), getUsers(), getAuditLogs(100)]).then(
      ([siteDoc, pageDocs, userDocs, auditDocs]) => {
        setSite(siteDoc);
        setPages(pageDocs);
        setUsers(userDocs);
        setLogs(auditDocs);
      }
    );
  }, []);

  if (!site) return <div className="p-10">กำลังโหลด...</div>;

  return (
    <RequireAuth branchEditorAllowed>
      <AppShell site={site}>
        <AdminConsole initialSite={site} initialPages={pages} initialUsers={users} initialLogs={logs} />
      </AppShell>
    </RequireAuth>
  );
}
