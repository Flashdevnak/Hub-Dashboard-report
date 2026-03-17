const required = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY"
];

const missing = required.filter((key) => !process.env[key]?.trim());

if (missing.length) {
  console.error("Missing required environment variables:");
  for (const key of missing) console.error(`- ${key}`);
  process.exit(1);
}

console.log("Environment variables look complete.");


const freeTierHints = [
  "Spark/Hobby mode: Cloud Storage ไม่จำเป็นสำหรับแพ็กนี้",
  "Spark/Hobby mode: หลีกเลี่ยง cron มากกว่า 1 ครั้ง/วันบน Vercel Hobby",
  "Spark/Hobby mode: import Excel/CSV ทำใน browser ไม่กิน Cloud Storage"
];

for (const hint of freeTierHints) console.log(`- ${hint}`);
