import seedData from "../seed/dashboard-seed.json";
import { adminAuth, adminDb } from "../lib/firebase-admin";

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

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error("Missing SEED_ADMIN_EMAIL or SEED_ADMIN_PASSWORD");
  }

  let userRecord;
  try {
    userRecord = await adminAuth.getUserByEmail(adminEmail);
  } catch {
    userRecord = await adminAuth.createUser({
      email: adminEmail,
      password: adminPassword
    });
  }

  await adminDb.collection("users").doc(userRecord.uid).set(
    {
      uid: userRecord.uid,
      email: adminEmail,
      role: "admin",
      allowedBranches: ["default"],
      updatedAt: new Date().toISOString()
    },
    { merge: true }
  );

  const site = getSeedSite();

  const branches: SeedBranch[] =
    Array.isArray(site.branches) && site.branches.length
      ? site.branches
      : [{ code: "default", name: "สาขาหลัก", area: "ส่วนกลาง", active: true }];

  const defaultBranchCode =
    site.defaultBranchCode || branches[0]?.code || "default";

  const sitePayload = {
    ...site,
    branches,
    defaultBranchCode
  };

  await adminDb.collection("site").doc("settings").set(sitePayload, { merge: true });

  for (const rawPage of getSeedPages()) {
    const branchCode = rawPage.branchCode || defaultBranchCode;
    const pageId = buildPageId(rawPage.slug, branchCode);
    const page = { ...rawPage, branchCode, pageId };
    await adminDb.collection("pages").doc(pageId).set(page, { merge: true });
  }

  console.log(`Seed complete. Admin email: ${adminEmail}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
