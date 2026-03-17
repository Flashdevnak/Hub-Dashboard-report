import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";

export const metadata = {
  title: "BNAK Centralized Dashboard",
  description: "Centralized KPI dashboard with Firebase backend"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}