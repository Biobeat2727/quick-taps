"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function NamePage() {
  const router = useRouter();
  const [name, setName] = useState("");

  useEffect(() => {
    if (localStorage.getItem("qt:name")) router.replace("/");
  }, [router]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    localStorage.setItem("qt:name", trimmed);
    router.push("/");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 bg-gray-950 text-white">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-amber-400">Quick Taps</h1>
        <p className="mt-2 text-gray-400">Bar games, always on.</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 w-full max-w-xs"
      >
        <label className="text-sm text-gray-400 text-center">
          What's your name?
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
          placeholder="Your name"
          autoFocus
          autoComplete="off"
          className="rounded-2xl px-4 py-4 text-lg bg-gray-800 border border-gray-700 focus:outline-none focus:border-amber-400 text-white placeholder-gray-500 text-center"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="rounded-2xl py-4 text-lg font-bold bg-amber-400 text-gray-950 disabled:opacity-40 active:scale-95 transition-transform"
        >
          Let's go
        </button>
      </form>
    </main>
  );
}
