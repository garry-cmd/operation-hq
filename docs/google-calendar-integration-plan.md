# Google Calendar Integration — Planning Doc
*Drafted: April 22, 2026 · Status: deferred, not started*

---

## TL;DR

Pulling Google Calendar into Operation HQ is a **2-evening project** for a useful read-only baseline. The technical work is medium effort; the friction is Google's OAuth setup, not the code. There's no rush — open this doc when the moment feels right, pick a tier below, then start at "Step-by-step plan."

---

## Decide first: which tier?

Three reasonable shapes, pick one before writing code. Each builds on the previous, so nothing is wasted if you start small and grow.

### Tier 1 — Passive context on Focus *(safe entry, ~2 evenings)*
Show today's calendar events in a strip on the Focus tab, next to the action list. No interaction beyond display. Goal: see meetings in the same place you see actions, so context-switching costs less.

**Why start here:** purely additive, no new mental model, and after a week you'll know whether you actually look at it or whether it's noise. If it's noise, you stop. If it's useful, you graduate to Tier 2.

### Tier 2 — Wrap into the Close Week wizard *(the most interesting, ~1 extra evening)*
At week close, show a list of last week's calendar events alongside the KR review step. Prompt: "did any of these advance a KR?" — let you tag events to KRs. Becomes a natural part of the weekly retro instead of standalone fluff.

**Why this is the most interesting:** plays to the existing weekly ritual. Calendar events are the artifact of how you spent your time; the wizard is where you reckon with progress. Pairing them is the actual insight.

### Tier 3 — Bidirectional time-blocking *(speculative, ~1 week)*
Drag a weekly action onto a calendar slot, write it back to Google. Two-way sync, conflict resolution, deletion semantics. **Don't start here.** Only consider after Tiers 1+2 prove you actually want calendar tightly woven in.

---

## Tier 1 step-by-step plan

### 1. Google Cloud Console setup *(~30 min, one-time)*
- Create a new GCP project named `operation-hq`
- Enable the **Google Calendar API**
- Configure OAuth consent screen:
  - User type: **External** (required for personal Gmail accounts)
  - App name, support email, developer contact
  - **Scopes:** `https://www.googleapis.com/auth/calendar.readonly`
  - **Test users:** add your own Gmail. Stay in "Testing" mode forever — solo use doesn't need verification.
- Create OAuth 2.0 Client ID:
  - Type: Web application
  - Authorized redirect URIs:
    - `http://localhost:3000/api/google/callback` (dev)
    - `https://hq.keeply.boats/api/google/callback` (prod)
- Save **Client ID** and **Client Secret** — going into Vercel env vars.

### 2. Vercel env vars *(~2 min)*
```
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI=https://hq.keeply.boats/api/google/callback
```
Add to local `.env.local` too with the localhost URI.

### 3. Supabase schema *(~5 min, one migration)*
```sql
CREATE TABLE user_google_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  scope text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE user_google_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users access own tokens" ON user_google_tokens
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```
*Note: tokens stored plaintext for now since this is solo-use. If ever multi-tenant, encrypt at rest.*

### 4. NPM deps
```
npm install googleapis
```

### 5. Files to create

| File | Purpose |
|---|---|
| `app/api/google/connect/route.ts` | Generates Google OAuth consent URL, redirects browser. |
| `app/api/google/callback/route.ts` | Receives the `code`, exchanges for tokens, upserts into `user_google_tokens`, redirects to `/hq`. |
| `app/api/google/disconnect/route.ts` | Deletes the user's token row. Optional but polite. |
| `app/api/google/events/route.ts` | Server-side: takes `?from=&to=` query params, refreshes token if needed, fetches events from primary calendar, returns JSON. |
| `lib/google.ts` | Helper: `getValidAccessToken(userId)` — returns a fresh token, transparently refreshing if `expires_at < now`. Used by the events route. |
| `components/CalendarStrip.tsx` | Renders today's events on Focus tab. Calls `/api/google/events`. |

### 6. Files to modify

| File | Change |
|---|---|
| `app/hq/page.tsx` | Fetch a "Google connection status" boolean (does user have a token row?) and pass to relevant components. |
| `components/Focus.tsx` | If connected, render `<CalendarStrip />` near the top. If not connected, render a small "Connect Google Calendar" button that hits `/api/google/connect`. |
| `lib/types.ts` | Add `GoogleEvent` type: `{ id, summary, start, end, location?, htmlLink }`. |

### 7. UX detail
- Connect button is small, in Focus or settings. Not pushy.
- Calendar strip is collapsed by default if there are >3 events; "Show all" expands.
- Each event shows: time range · title · location (if any). Click opens `htmlLink` in Google Calendar.
- Failure modes: token revoked, network error, no events today — all degrade silently to "no events" with a quiet retry. Don't break the Focus tab if Calendar is down.

---

## Open questions to resolve before starting

1. **Which calendar?** Just `primary`, or let user pick from their list? Start with primary; add picker later if needed.
2. **All-day events:** show or hide? Probably hide on Focus (clutter) but include in wizard view.
3. **Recurring events:** the API handles expansion if you query a specific time range. Use `singleEvents=true&orderBy=startTime` on the list call.
4. **Multiple Google accounts:** stay single-account for now. Token table has `UNIQUE(user_id)` to enforce.
5. **Wizard tier — auto-tag suggestions?** Pattern-match event titles against KR titles ("gym" → Gym 3x/week)? Could be useful, could be noise. Defer until you have data.

---

## Things that will bite if you forget

- **Refresh tokens are only returned on the FIRST consent.** If you re-consent without revoking, you only get an access token and your refresh token is dead. Always include `prompt=consent&access_type=offline` in the auth URL to force a fresh refresh token.
- **Google Calendar API quota:** generous (1M requests/day) but per-user limits exist. Cache aggressively if you ever load events on every Focus render — debounce to once per minute.
- **Token expiry timing:** access tokens last 1 hour. Always check `expires_at` and refresh proactively; don't wait for a 401. The `lib/google.ts` helper handles this in one place.
- **Verification warning:** since you're staying in Testing mode, the first connect shows "Google hasn't verified this app." Click "Advanced" → "Go to operation-hq (unsafe)". One-time per Google account.
- **Test users cap:** Testing mode allows up to 100 test users. Solo use, fine forever.

---

## When you come back to this

1. Re-read the "Decide first" section. Has your view of the tier shifted?
2. Confirm the deferred items in the main backlog haven't moved this down or up the priority list.
3. Block 2 evenings. Tier 1 should be deployable end of evening 2.
4. Start with GCP setup (the click-fest) — do that first so you don't lose momentum mid-build waiting for OAuth screens.

---

## References (for future-you)

- `googleapis` npm: <https://www.npmjs.com/package/googleapis>
- Calendar API list endpoint: <https://developers.google.com/calendar/api/v3/reference/events/list>
- OAuth consent setup: <https://support.google.com/cloud/answer/10311615>
- The `parseDateLocal` / timezone learnings from the Focus bug fight (Apr 22) are relevant — calendar events arrive with timezone info; render in user's local zone, not UTC.
