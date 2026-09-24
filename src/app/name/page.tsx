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
    <main
      className="flex flex-col items-center justify-center gap-10 px-6"
      style={{ minHeight: "100dvh" }}
    >
      <div className="text-center">
        <h1 className="neon-sign neon-power-on text-6xl leading-[0.95]">
          Quick
          <br />
          Taps
        </h1>
        <p className="mt-5 text-[var(--qt-mute)]">The bar arcade. Always on.</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 w-full max-w-xs"
      >
        <label
          htmlFor="player-name"
          className="text-sm text-[var(--qt-mute)] text-center"
        >
          What&apos;s your name?
        </label>
        <input
          id="player-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
          placeholder="Your name"
          autoFocus
          autoComplete="off"
          className="rounded-2xl px-4 py-4 text-lg bg-[var(--qt-panel)] border border-[var(--qt-line)] focus:outline-none focus:border-[var(--qt-amber)] focus:shadow-[0_0_18px_rgba(255,180,36,0.2)] text-[var(--qt-cream)] placeholder-[var(--qt-mute)] text-center transition-shadow"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="btn-amber rounded-2xl py-4 text-lg font-bold uppercase tracking-wide disabled:opacity-40 active:scale-95 transition-transform"
        >
          Let&apos;s go
        </button>
      </form>
    </main>
  );
}
