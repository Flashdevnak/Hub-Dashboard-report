import { NextResponse } from "next/server";

export async function GET() {
  const requiredPublic = [
    "NEXT_PUBLIC_FIREBASE_API_KEY",
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    "NEXT_PUBLIC_FIREBASE_APP_ID"
  ];

  const requiredServer = [
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY"
  ];

  const missingPublic = requiredPublic.filter((key) => !process.env[key]?.trim());
  const missingServer = requiredServer.filter((key) => !process.env[key]?.trim());

  const ok = missingPublic.length === 0 && missingServer.length === 0;

  return NextResponse.json(
    {
      ok,
      timestamp: new Date().toISOString(),
      checks: {
        publicEnvConfigured: missingPublic.length === 0,
        serverEnvConfigured: missingServer.length === 0
      },
      missing: {
        public: missingPublic,
        server: missingServer
      }
    },
    { status: ok ? 200 : 500 }
  );
}
