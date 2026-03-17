import seedData from "../seed/dashboard-seed.json";
import { adminAuth, adminDb } from "../lib/firebase-admin";

function buildPageId(slug: string, branchCode = "default") {
  return `${branchCode}__${slug}`;
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

  await adminDb.collection("users").doc(userRecord.uid).set({
    uid: userRecord.uid,
    email: adminEmail,
    role: "admin",
    allowedBranches: ["default"],
    updatedAt: new Date().toISOString()
  }, { merge: true });

  const sitePayload = {
    ...seedData.site,
    branches: seedData.site.branches?.length ? seedData.site.branches : [
      { code: "default", name: "สาขาหลัก", area: "ส่วนกลาง", active: true }
    ],
    defaultBranchCode: seedData.site.defaultBranchCode || "default"
  };

  await adminDb.collection("site").doc("settings").set(sitePayload, { merge: true });

  for (const rawPage of seedData.pages) {
    const branchCode = rawPage.branchCode || "default";
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
