# Quick Taps

Always-on bar mini games for IPA, Coeur d'Alene, ID.

No host. No schedule. Scan a QR code, pick a name, and play.

---

## What is Quick Taps?
Quick Taps is the third pillar of IPA's bar entertainment suite, alongside **Tapped In!** (hosted trivia) and **What's on Tap?** (hosted party games). Unlike those, Quick Taps requires no staff involvement — it runs continuously and is always available to anyone in the bar.

Players scan a QR code at any table, enter a name, and either join an open session or start their own. Games are short, casual, and designed for 2–8 players sitting together.

## Games
- **Marble Race** — pick a color, watch your marble race down a three-act track (plinko → crossing lanes → funnel). First out wins.

More games coming.

## Player flow
1. Scan QR code → land on session list
2. First visit: enter a name (saved to device, skipped on return visits)
3. Choose an open session to join, or start a new one
4. Pick a game → waiting room → race

## Tech stack
- Next.js 15, TypeScript, App Router
- Tailwind CSS, shadcn/ui, Framer Motion
- Ably (realtime)
- Neon (PostgreSQL)
- Upstash Redis (ephemeral session state)
- Vercel (deployment)

Shares infrastructure with What's on Tap?. See `docs/ARCHITECTURE.md`.

## Local development

```bash
npm install
npm run dev
```

Requires a `.env.local` file with the same credentials as What's on Tap?:

```
ABLY_API_KEY=
DATABASE_URL=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

## Docs
- `docs/ARCHITECTURE.md` — session model, Redis shape, Ably channels, DB schema
- `docs/MARBLE_RACE.md` — full game spec including track geometry and physics