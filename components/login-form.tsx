"use client";

import { useState } from "react";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase-client";
import { upsertUserProfile } from "@/lib/firestore";
import { useRouter, useSearchParams } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    try {
      if (mode === "login") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        await upsertUserProfile({
          uid: credential.user.uid,
          email: credential.user.email,
          role: "user"
        });
      }
      router.replace(nextPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-md rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-[0.25em] text-yellow-600">Auth</p>
      <h1 className="mt-2 text-3xl font-black">เข้าสู่ระบบ</h1>
      <p className="mt-2 text-sm text-slate-500">admin และ user ใช้ Firebase Authentication ชุดเดียวกัน</p>

      <div className="mt-5 flex gap-2">
        <button onClick={() => setMode("login")} className={mode === "login" ? "rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white" : "rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold"}>Login</button>
        <button onClick={() => setMode("register")} className={mode === "register" ? "rounded-xl bg-yellow-400 px-4 py-2 text-sm font-black text-slate-900" : "rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold"}>Register</button>
      </div>

      <form onSubmit={submit} className="mt-5 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-semibold">Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none" required />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold">Password</label>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none" required />
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <button type="submit" className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white">
          {mode === "login" ? "เข้าสู่ระบบ" : "สร้างผู้ใช้ใหม่"}
        </button>
      </form>
    </div>
  );
}
