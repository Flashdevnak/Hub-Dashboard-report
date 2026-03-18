import { NextRequest, NextResponse } from "next/server";
import seedData from "@/seed/dashboard-seed.json";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SeedBranch = {
  code: string;
  name: string;
  area?: string;
  active?: boolean;
};

type SeedSite = {
  appName?: string;
  brand?: string;
  theme?: {
    primary?: string;
    dark?: string;
  };
  nav?: Array<{
    slug: string;
    label: string;
    group?: string;
  }>;
  branches?: SeedBranch[];
  defaultBranchCode?: string;
};

type SeedPage = {
  slug: string;
  title?: string;
  branchCode?: string;
  [key: string]: unknown;
};

function buildPageId(slug: string, branchCode = "default") {
  return `${branchCode}__${slug}`;
}

function getSeedSite(): SeedSite {
  return (seedData.site ?? {}) as SeedSite;
}

function getSeedPages(): SeedPage[] {
  return Array.isArray(seedData.pages) ? (seedData.pages as SeedPage[]) : [];
}

function getBearerToken(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
    }

    const decoded = await adminAuth.verifyIdToken(token);
    const userRef = adminDb.collection("users").doc(decoded.uid);
    const userProfileSnap = await userRef.get();

    const usersSnapshot = await adminDb.collection("users").limit(1).get();
    const isBootstrap = usersSnapshot.empty;

    if (!isBootstrap) {
      const role = userProfileSnap.exists ? userProfileSnap.data()?.role : null;
      if (role !== "admin") {
        return NextResponse.json({ error: "Admin only" }, { status: 403 });
      }
    }

    const site = getSeedSite();
    const pages = getSeedPages();

    const branches: SeedBranch[] =
      Array.isArray(site.branches) && site.branches.length
        ? site.branches
        : [{ code: "default", name: "สาขาหลัก", area: "ส่วนกลาง", active: true }];

    const defaultBranchCode = site.defaultBranchCode || branches[0]?.code || "default";

    if (isBootstrap) {
      await userRef.set(
        {
          uid: decoded.uid,
          email: decoded.email || null,
          role: "admin",
          allowedBranches: branches.map((b) => b.code),
          updatedAt: new Date().toISOString()
        },
        { merge: true }
      );
    }

    await adminDb.collection("site").doc("settings").set(
      {
        ...site,
        branches,
        defaultBranchCode,
        updatedAt: new Date().toISOString()
      },
      { merge: true }
    );

    let pageCount = 0;
    for (const rawPage of pages) {
      const branchCode = rawPage.branchCode || defaultBranchCode;
      const pageId = buildPageId(rawPage.slug, branchCode);
      await adminDb.collection("pages").doc(pageId).set(
        {
          ...rawPage,
          branchCode,
          pageId,
          updatedAt: new Date().toISOString()
        },
        { merge: true }
      );
      pageCount++;
    }

    await adminDb.collection("audit_logs").add({
      action: "system.seed",
      entityType: "bundle",
      entityId: "initial-seed",
      actorUid: decoded.uid,
      actorEmail: decoded.email || null,
      summary: isBootstrap
        ? `Bootstrap + seed completed with ${pageCount} pages`
        : `Seed completed with ${pageCount} pages`,
      createdAt: new Date().toISOString(),
      meta: {
        bootstrap: isBootstrap,
        pageCount,
        branchCodes: branches.map((b) => b.code)
      }
    });

    return NextResponse.json({
      ok: true,
      bootstrap: isBootstrap,
      pageCount,
      defaultBranchCode,
      branches
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
