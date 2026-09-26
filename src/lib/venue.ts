// Which bar this deployment serves. Bar-agnostic: identity comes from env, never
// from code. Local development always writes to venue 'dev' so testing can't
// pollute a real bar's leaderboard (the database is shared with production).

export const VENUE_ID =
  process.env.NODE_ENV === 'production' ? (process.env.QT_VENUE_ID || process.env.NEXT_PUBLIC_QT_VENUE_ID || 'pilot') : 'dev';

export const VENUE_TZ = process.env.QT_VENUE_TZ || 'America/Los_Angeles';

/** A bar night runs 4 AM → 4 AM venue time, so a 1 AM game counts for "tonight". */
const NIGHT_ROLLOVER_HOURS = 4;

/** The venue-local night a moment belongs to, as 'YYYY-MM-DD'. */
export function nightOf(date: Date = new Date(), tz: string = VENUE_TZ): string {
  const shifted = new Date(date.getTime() - NIGHT_ROLLOVER_HOURS * 3_600_000);
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(shifted);
}
