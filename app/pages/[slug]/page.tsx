"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageRenderer } from "@/components/page-renderer";
import { RequireAuth } from "@/components/require-auth";
import { getPage, getSiteConfig } from "@/lib/firestore";
import type { PageDoc, SiteConfig } from "@/lib/types";

export default function DynamicPage() {
  const [site, setSite] = useState<SiteConfig | null>(null);
  const [page, setPage] = useState<PageDoc | null>(null);
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const branchCode = searchParams.get("branch") || undefined;

  useEffect(() => {
    const slug = params?.slug;
    if (!slug) return;

    Promise.all([getSiteConfig(), getPage(slug, branchCode)]).then(([siteDoc, pageDoc]) => {
      setSite(siteDoc);
      setPage(pageDoc);
    });
  }, [params, branchCode]);

  if (!site || !page) return <div className="p-10">กำลังโหลด...</div>;

  return (
    <RequireAuth>
      <AppShell site={site}>
        <PageRenderer page={page} />
      </AppShell>
    </RequireAuth>
  );
}
