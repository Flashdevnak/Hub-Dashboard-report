"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase-client";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setChecking(false);

      if (!currentUser) {
        window.location.href = "/login?next=/setup";
      }
    });

    return () => unsub();
  }, []);

  async function seedSystem() {
    if (!user) return;

    setLoading(true);
    setMessage("");

    try {
      const token = await user.getIdToken(true);

      const res = await fetch("/api/admin/seed", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Seed failed");
      }

      setMessage(`Seed สำเร็จแล้ว (${data.pageCount} pages)`);

      await user.getIdToken(true);

      window.location.href = "/admin?seeded=1";
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "เกิดข้อผิดพลาด");
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return <div className="p-6">Checking auth...</div>;
  }

  return (
    <div className="mx-auto mt-16 max-w-xl rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-[0.25em] text-yellow-600">Setup</p>
      <h1 className="mt-2 text-3xl font-black">Initialize System</h1>
      <p className="mt-2 text-sm text-slate-500">
        กดครั้งเดียวเพื่อสร้าง site settings, pages และ bootstrap admin บนระบบออนไลน์
      </p>

      <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
        <div>
          <b>User:</b> {user?.email || "-"}
        </div>
        <div className="mt-1">
          <b>Mode:</b> Online seed via server route
        </div>
      </div>

      {message ? (
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          {message}
        </div>
      ) : null}

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={seedSystem}
          disabled={loading || !user}
          className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {loading ? "Seeding..." : "Seed System"}
        </button>

        <button
          type="button"
          onClick={() => {
            window.location.href = "/admin";
          }}
          className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold"
        >
          ไปหน้า Admin
        </button>
      </div>
    </div>
  );
}
