# Operation HQ — CONTEXT

> **Single source of truth.** Read this first; update once at session end.
> Historical session-by-session detail lives in `docs/operation-hq-pickup-notes.md`
> (retained for history, no longer the working doc) and the dated
> `docs/operation-hq-session-*.md` logs. Last updated: **Jun 20, 2026**.

---

## What this is

A single-user life-management + OKR system. Desktop-first, used many times a day.
Modules: **OKRs + Roadmap** (strategic), **Focus + Tasks + Notes + Calendar** (daily),
**Reflect + Parking** (archive). Garry is the sole user (Mel/multi-user is deferred
indefinitely — see Backlog).

---

## Stack & infra

| Item | Value |
|------|-------|
| Repo | https://github.com/garry-cmd/operation-hq (no `src/`; code at `app/`, `components/`, `lib/`, `lib/db/`; docs in `docs/`) |
| Live URL | https://hq.svirene.com (also `hq.keeply.boats`, `operation-hq.vercel.app`) |
| Vercel project | `prj_rgWkigVjdCzawkB3g00GqTIMFTEC` · team `team_FD2H6R0bDq59mIOZWsPE8YLg` |
| Supabase project | `hepkoszkdwsajfjcedst` · org `xnlytjeypeozaokqepxp` (Keeply) |
| Node | 24.x · Next.js 16.2.1, React 19, TypeScript 5, Tailwind v4, Turbopack |

**Auth model:** plain `@supabase/supabase-js` browser client (`lib/supabase.js`, anon key,
localStorage sessions, email/password `signInWithPassword`). **No** `@supabase/ssr`, no
cookies, no middleware. localStorage session key `sb-hepkoszkdwsajfjcedst-auth-token`.
Garry's `user_id` = `91ae1704-b98d-4212-a096-bc8ccc5b5581`.

**RLS posture (single-user):** most tables use `owner_all USING (true)` — **no `user_id`
column** on app tables (e.g. `calendar_blocks`). `spaces` has RLS disabled. The exception is
`user_google_tokens`, scoped `auth.uid() = user_id` (holds OAuth tokens). Server routes that
touch the DB with the service-role client must **not** filter app tables by `user_id` — the
column doesn't exist. This bit us once (commit route 500'd on a phantom `user_id` filter).

---

## Current state — shipped

### Jun 20 — AI Chief of Staff agent + Voice (Step 1)

**Chief of Staff** — an in-app agent that knows the whole operation and can act, **propose-first**.
NavRail entry (`screen==='agent'`). Runs `claude-sonnet-4-6` via the Anthropic API
(`ANTHROPIC_API_KEY`, Vercel Production). Read broadly, act narrowly, never mutate without approval.

- **Context layer** (`lib/agentContext.ts` → `buildAgentContext({today, weekStart})`) — assembles a
  full HQ snapshot server-side each turn (spaces, KRs, weekly actions, tasks, capacity + calendar
  blocks, weekly reviews, notes, metric check-ins) into compact text, ids tagged (`[task:uuid]`,
  `[kr:uuid]`, `[space:uuid]`) so tools reference real rows. THE reusable "knows everything" layer.
- **Streaming** — `/api/agent` sets `stream:true`, proxies Anthropic SSE → NDJSON
  (`{t:'text'|'actions'|'error'}`); client types the reply live and (voice) speaks it. Parser
  bridges a space across web-search text-block splits ("hours.Perfect" → "hours. Perfect") — only
  before a letter/digit, never before punctuation/whitespace.
- **Web search** — Anthropic server tool `web_search_20250305` (runs in-turn, read-only, no
  approval). Persona forbids inventing venues/hours/specifics — search or say it couldn't confirm.
- **Propose-first tools** (NEVER auto-execute — render a confirm card, run on Approve only):
  `complete_task` (uses canonical `tasksDb.toggleComplete` — **recurring tasks roll forward**, not
  killed), `reschedule_task`, `add_task`, `set_kr_health`, `create_calendar_event`. State setters
  (tasks/KRs/calendarBlocks) live in `page.tsx`, passed into `Agent.tsx`.
- **Calendar events from chat** — `create_calendar_event` → `POST /api/google/block` (new handler):
  inserts a committed **free-form** `calendar_blocks` row FIRST, then creates the Google event,
  **rolls the row back if Google fails**. Lands on the **HQ** Google calendar (kept agent events in
  the work time-block layer, not primary — decided this session).

Files: `lib/agentContext.ts`, `app/api/agent/route.ts`, `lib/db/agentApi.ts`, `components/Agent.tsx`.
Migration: `relax_calendar_block_source_for_freeform_events` (applied via Supabase MCP).
**Decided this session: the agent does NOT touch Plan-My-Week** (that button stays on Calendar).

**Voice (Step 1 — push-to-talk · DEPLOYED, BLOCKED on real keys):** mic button in Chief of Staff,
four states (idle → listening → thinking → speaking). `lib/voice/useVoice.ts` records the mic
(MediaRecorder/webm) → `POST /api/voice/transcribe` (Deepgram **nova-3**) → feeds the text into the
agent stream in **voice mode** (terse, no-markdown persona) → speaks the reply sentence-by-sentence
via `/api/voice/speak` (ElevenLabs **eleven_flash_v2_5**, streamed mp3, queued playback) so the
first sentence speaks while the rest generates. Markdown stripped before TTS; starting the mic
barges in on playback. Scope is talk→hear; proposed actions still show a tap-Approve card (verbal
"yes" is Step 2).
**BLOCKED:** `DEEPGRAM_API_KEY` + `ELEVENLABS_API_KEY` (optional `ELEVENLABS_VOICE_ID`, default
Rachel `21m00Tcm4TlvDq8ikWAM`) must hold **real values**, scoped Vercel **Production**, **then a
redeploy** (env changes don't retro-apply to existing deployments). Both routes verified live
returning a graceful 503 "not configured" until keys land. Free tiers (Deepgram $200 credit,
ElevenLabs 10k chars/mo) are enough to test. **NEXT SESSION:** real keys → redeploy → round-trip
verify (TTS a phrase, feed the mp3 to STT, expect the transcript back) → live speak test.


### Jun 20 (late) — Tasks: Backlog smart view

`components/Tasks.tsx`: new `'backlog'` SmartView = **undated open tasks** (`!due_date`,
non-subtask, not completed) across all spaces + lists. Sidebar row (stacked-bars
`BacklogIcon`) between Recurring and All open, with live count. Pure filter, no schema
change. This is the triage destination the planned **Home deck**'s "Backlog" action targets.
(Undated tasks bucket under "Later" in the list view — minor wart, acceptable.)

### Planned next — Unified "Home" weekly command deck (DESIGN APPROVED, mockups locked)

The big one. Focus becomes the **all-spaces home page** (top of NavRail, default landing
screen); the existing all-spaces **Overview/`Summary` screen gets deleted** (this replaces it).
Design approved over 7 mockup iterations (`hq-home-week-deck-mockup-v7.html`). Shape:

- **Color = space** everywhere (5 space dots; legibility pass on space colors still TODO —
  Keeply `#0B1E3F` is invisible on dark, needs a display variant).
- **Daily quote** under the header — curated public-domain pool (stoics · sailors · Franklin),
  rotated by day-of-year, no external API. (`lib/quotes.ts`.)
- **Space filter chips** (All + per-space) filter the whole board.
- **Shape-of-week ribbon** — calendar only (meetings · all-day · holidays), Mon–Sun, today
  highlighted. Needs the all-day-events fetch (currently skipped — see follow-ups).
- **Key actions** — all spaces, flat, grouped by space (2 levels, not 3); each row has a
  completion bubble + obj/KR pill. Click pill → loads that KR's notes.
- **Right rail** — Tasks-due-this-week (completable, space-dotted, "Backlog ↗" link) ·
  Habits (all-spaces compact grid) · Notes (contextual, click-a-KR-to-load, click-to-open editor).
- **Needs attention** — moved **below the fold** (no crisis-first). **Overdue tasks ONLY**
  (off-track/blocked KRs are handled in planning, NOT here). Inline actions: complete ·
  **Backlog** (clear due date → backlog view) · **Snooze** (→ tomorrow) · **Kill** (hard delete).
- **FAB** bottom-right — quick-add task / key action / note / event.

**Build sequence (staged, each independently deployable):**
1. ✅ Backlog smart view in Tasks (shipped Jun 20).
2. Schema: `notes.roadmap_item_id` nullable migration (mirrors `tasks.roadmap_item_id`) + verify.
3. Notes↔KR: link picker in Notes editor header + `lib/db/notes` helper.
4. All-day Google events: surface in the fetch (currently skipped) for the ribbon.
5. `lib/quotes.ts` daily-quote module (curated array + day-of-year selector).
6. The Home deck itself — new all-spaces screen; make it default landing + top NavRail entry.
7. Delete the Overview/`Summary` screen + its route once Home covers it.
8. Inline handlers: complete / Backlog / Snooze→tomorrow / Kill (hard delete) + FAB quick-add.

Decisions locked: notes = click-to-open (not inline edit); Backlog lives in Tasks; Kill =
hard delete (no confirm); attention = overdue tasks only; quote pool = public-domain
sailors/stoics/Franklin.

### This session (Jun 19/20) — Calendar + Google Calendar integration

**Calendar module** — a first-class all-spaces time-blocking view (own NavRail entry).
- **Template mode:** drag-to-create a standing weekly capacity template. Each window is
  space-scoped (or "Any") and kind-scoped (`kr_action` | `task` | `both`).
- **Week mode:** Mon–Sun time grid (6 AM–10 PM). HTML5 drag-and-drop to place unscheduled
  items (KR actions + due tasks, each with a duration) into matching capacity windows;
  drop validation mirrors the planner's `accepts()` (kind + space must match; clamps to the
  window; invalid drops rejected with a toast). Drag a placed block to reschedule.
- **Greedy planner** (`lib/calendarPlan.ts`, pure) — "Plan week" first-fits items into
  matching windows, off-track KRs first, then priority, then due date; schedules **around**
  commitments (committed HQ blocks + Google meetings). Blocks are `proposed` (dashed) until
  committed.

**Todoist strip removed → native FocusTasks.** `TodoistStrip.tsx` + `/api/todoist/*` deleted;
`components/FocusTasks.tsx` shows native week-scoped (Mon–Sun) space tasks on Focus. **This
completes the parked D3 / Todoist-retirement** — HQ no longer reads Todoist at runtime.

**Google Calendar integration** (working, confirmed):
- OAuth (offline + `prompt=consent` → durable refresh token), HMAC-signed state carrying
  `user_id`, token refresh ≤30s before expiry. On connect, a dedicated **"HQ"** Google
  calendar is found/created and its id stored.
- **Calendar selector** — header dropdown lists the user's Google calendars; checked ones
  (`read_calendar_ids`) feed the meetings overlay.
- **Meetings overlay** — events from selected calendars render read-only (hatched) on the
  week grid and feed the planner as busy time. All-day + `transparency:'transparent'` (free)
  events are skipped.
- **Commit to Google** — writes the week's proposed blocks to the HQ calendar and flips them
  to `committed` (records `google_event_id`). Removing a committed block deletes its Google
  event; moving one patches the event. Proposed blocks stay client-side (fast).

Routes (`app/api/google/*`, all `runtime='nodejs'`, `dynamic='force-dynamic'`):
`connect` · `callback` (redirects `?google=error&reason=<exchange|calendar|save|...>` on
failure) · `disconnect` · `calendars` (GET list / POST save selection) · `events` (GET range)
· `commit` (POST) · `block` (DELETE = remove + Google delete, PATCH = move + Google patch).

Key files: `lib/google.ts` (server: OAuth + Calendar REST), `lib/supabaseAdmin.ts`
(service-role client), `lib/db/googleApi.ts` (client wrappers, attaches Bearer), `lib/db/
capacityBlocks.ts`, `lib/db/calendarBlocks.ts`, `lib/calendarPlan.ts`, `components/Calendar.tsx`,
`components/FocusTasks.tsx`.

Env (Vercel, Production): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REDIRECT_URI=https://hq.svirene.com/api/google/callback`, `SUPABASE_SERVICE_ROLE_KEY`,
plus the existing `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Google Cloud:
project `operation-hq`, Calendar API enabled, OAuth consent **published to Production**,
redirect URIs for prod + `localhost:3000`.

**Agent + voice env (Vercel, Production):** `ANTHROPIC_API_KEY` (live, working) · `DEEPGRAM_API_KEY`,
`ELEVENLABS_API_KEY`, optional `ELEVENLABS_VOICE_ID` (**slots added but need real values + redeploy**).

### Earlier Jun 19 (sessions 1–4) — summary (detail in pickup-notes / session log)

1. **Objective/KR time windows + metric cards** — objective start/end dates, overdue alarm,
   KR date windows on Roadmap, unified `EditKRModal`, metric sparklines + flip cards.
2. **Notes → near-Evernote parity** — inline images + attachments (private `note-media`
   bucket, body stores storage path), tables, focus mode, pinned notes, `[[ ]]` links,
   quick-file Move, Markdown export, `note_versions`, sub-notebooks depth 3.
   **Strategic call: Evernote → REPLACE.**
3. **Command Palette (⌘K)** — flat ranked multi-source index, scoping operators
   (`#tag`, `in:<space>`, `task:`/`note:`/`kr:`/…), fuzzy typo tolerance, recents, deep-links
   with scroll-to + flash. New: `lib/search.ts`, `components/CommandPalette.tsx`,
   `lib/scrollFlash.ts`.
4. **Kill Todoist** — native Tasks to parity (durations, deadlines, subtasks, KR-link picker,
   sections in lists + spaces, recurrence), migrated 87 non-OKR/non-boat Todoist tasks into HQ.

---

## Open follow-ups / tech debt (newest first)

- **Voice keys (BLOCKER for voice).** `DEEPGRAM_API_KEY` + `ELEVENLABS_API_KEY` are placeholder/empty
  in Vercel — need real values from the provider dashboards, scoped Production, then a redeploy.
  Until then `/api/voice/*` return 503. First thing next session.
- **Migrations applied via Supabase MCP aren't repo files.** This session's
  `relax_calendar_block_source_for_freeform_events` (and prior ones) live in Supabase's migration
  history, not as tracked files in the repo. Fine operationally; capture as files only if/when
  repo-side migration tracking is wanted.
- **Streaming cosmetic (minor):** voice persona keeps replies terse, but long screen replies can
  still run a sentence together at a web-search boundary in rare punctuation cases — current bridge
  is conservative. Revisit only if it recurs.
- **`APP_TZ` hardcoded to `America/Los_Angeles`** (`lib/google.ts`). Calendar blocks +
  Google event times assume Pacific wall-clock. Mexico-based weeks render offset until this
  is per-user configurable. Not a blocker for PNW use.
- **Rotate `SUPABASE_SERVICE_ROLE_KEY`** — it transited a chat session during setup. Rotate
  in Supabase + update Vercel when convenient.
- **All-day Google events skipped** in the meetings overlay (v1). Timed events only.
- **HTML5 DnD has no auto-scroll** near grid edges on the week view.
- **Audit #4** — extract `useSpaceData(activeSpaceId)` hook (drops ~100 lines from
  `page.tsx`). **Audit #5** — design-token module `lib/tokens.ts` (incremental).

---

## Backlog / roadmap

### 🔴 Next-session candidates
1. **★ Voice — finish Step 1 + build Step 2.** First: real Deepgram/ElevenLabs keys → redeploy →
   verify the loop live. Then **Step 2 — verbal action confirmation:** the agent speaks a proposal,
   you say "yes"/"do it", it executes (replaces the tap-Approve when hands-free). Same proposed-action
   objects; just a spoken confirm/deny turn. Later: **Step 3** quality/voice tuning, **Step 4**
   hands-free wake-word host (Picovoice Porcupine, docked phone + Bluetooth speaker — the endgame).
2. **★ Unified Home weekly command deck** — DESIGN APPROVED, build sequence in "Current state →
   Planned next" above. Multi-deploy: notes↔KR schema, all-day events, quote module, the deck,
   kill Overview, inline handlers. Step 1 (Backlog view) done.
3. **Re-plan button decision** — currently opens legacy `PlanWeek` modal. Likely just delete it +
   `PlanWeek` (~10min). Confirm Re-plan is unused first.
4. **Subtasks UI polish** — `parent_task_id` shipped on Tasks; confirm parity on Focus/Calendar surfaces.

### 🟡 Feature backlog
5. `useSpaceData` hook (audit #4). ~1hr.
6. "Plan your first week" for empty spaces (see Parked).
7. Quarter-close summary when the rolling 4Q window advances. ~3–4hr.
8. Recurring-action visual badge on Focus. ~30min.
9. Drag to reorder objectives (`sort_order` exists). ~2hr.
10. Drag to reorder tasks (`sort_order` exists). ~2hr.
11. Extract shared `TAG_STYLE`/tag picker (dup'd in `Focus`, `ActionPanel`, `Tasks`). ~30min.
12. Propagate done-KR treatment (strikethrough + 0.45 opacity) beyond Roadmap. ~1hr.
13. Metric-card pace-aware status (compare progress to quarter time-elapsed). ~1–2hr.
14. Responsive `ActionPanel` / `ObjectivePanel` (still desktop-only at 800px). ~2hr.
15. **Calendar:** per-user timezone (kills the `APP_TZ` hardcode); all-day event handling in overlay; recurring HQ blocks; DnD edge auto-scroll.

### 🟢 Nice to have
Share-page query optimization · PWA install prompt · keyboard shortcuts (⌘Enter save, Esc close) · Reflect history sparkline.

### ❄️ Deferred indefinitely
- **Multi-user SaaS-ification** (Mel + shared spaces) — needs real RLS, `spaces.owner_user_id`
  + `space_members`, every policy rewritten, invite/signup, role-aware UI. 8–20hr, planning doc first.
- **RLS hardening pass** — `spaces` RLS disabled; others `owner_all USING (true)`. Fine solo, exposed multi-user.

### Parked / open decisions
- **"Plan your first week" for empty spaces** — Path 1 (AI infra) / Path 2 (form recovery) / Path 3 (empty-state CTAs).
- **`annual_objectives.notes` column** — dormant since Apr 27, replaced by `objective_logs`. Drop someday, no urgency.
- **Notes editor** — TipTap, locked.

---

## Conventions

1. **Cobalt accent = interactive vocabulary; night-watch = status display.** Buttons, links,
   active nav, brand wordmark, "+ Add" CTAs stay cobalt. Section labels, status chips, hero
   readouts go night-watch. Mixing is intentional.
2. **Global token re-pointing as a propagation lever.** Evolve a palette by re-pointing tokens
   in `globals.css`, not per-component edits (reserve those for identity tokens).
3. **`flex:1` + `minHeight:0` for fill-remaining-viewport on mobile** (CSS Grid stretches
   unpredictably when most children are `display:none`).
4. **Hard refresh after deploy** (Ctrl/Cmd+Shift+R) when touching `globals.css` or big restructures — Vercel edge cache holds CSS.
5. **`onPickResult` callback over `onScreenChange`** when results carry deep-link payload.
6. **"Does the underlying need still exist?"** before building a backlog item — interrogate it at decision time.
7. **Schema-before-code** — apply + verify migrations before writing the code that uses them.
8. **Single-user RLS reality** — app tables have no `user_id`; never filter them by it server-side.
   `userId` is only for auth gating + the `user_google_tokens` lookup.
9. **Supabase Postgrest errors are NOT `instanceof Error`** — they're plain objects. Extract the
   message via `(e && typeof e === 'object' && 'message' in e) ? String(e.message) : 'error'`, or
   return `error.message` directly. A bare `e instanceof Error ? e.message : 'error'` masked a real
   constraint failure as `{"error":"error"}` this session.
10. **DB row before external API call.** Insert/commit the DB row first, THEN call the external
    service (Google event); roll the row back if the external call fails. Reverse order orphans
    external records when a constraint/validation rejects the insert.
11. **Agent tools are propose-first.** A tool call renders a confirmation card and only mutates on
    Approve — never auto-execute. `web_search_20250305` is the exception (read-only Anthropic server
    tool, runs in-turn). The NDJSON stream parser ignores non-`text`/non-custom-`tool_use` blocks.
12. **Reuse the canonical mutation path in the agent**, not a re-implementation — e.g. `complete_task`
    must call `tasksDb.toggleComplete` so recurring tasks roll forward instead of being hard-completed.

Earlier (May 14): desktop-first; SECURITY DEFINER RPCs for anon validation; NULL as "applies
broadly" sentinel; paired text+structured forms; rolling state over event logs for recurrence;
no-dep date math.

---

## Deploy workflow (macOS / zsh)

Garry deploys from `~/Downloads` (files arrive flat). Claude stages to
`/mnt/user-data/outputs/<proj>-<change>/` with **distinct flat filenames** (multiple `route.ts`
collide in Downloads → stage as `commit-route.ts`, `block-route.ts`, …), surfaces with
`present_files`, then gives ONE fenced bash block:

```bash
cd ~/operation-hq
git pull origin main
# mkdir -p ~/operation-hq/<new/dir> for any NEW directories first
cp ~/Downloads/<File> ~/operation-hq/<path>/<File>   # one explicit cp per changed file
npm run build
git add -A
git commit -m "<message>"
git push origin HEAD:main
```

**Rules:** one explicit `cp` per file (never shell vars for paths, never directory-level
`cp -R`, never paste code in chat as a substitute). Single block, copy-paste order, no
inter-command prompts. Push only if build is green. Staging-first deploys end the first block
with a staging push + "test, then run:" + a separate block for main.

**Sandbox verify before staging:** clone at `/tmp/operation-hq`;
`npx tsc --noEmit 2>&1 | grep -v validator.ts`, then
`rm -rf .next && NEXT_PUBLIC_SUPABASE_URL="https://dummy.supabase.co" NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy" npm run build`.
When re-patching files already touched this session, re-sync first
(`git fetch --depth 1 origin main && git reset --hard origin/main`) — main moves fast.

---

## Spaces & IDs reference

| Space | space_id |
|---|---|
| Stellar (APT) | `f7f2fdd9-bbf6-4f30-ac1f-bd06b81d7d99` |
| VidScrip | `572f74de-d3bf-4aec-831b-c8c2dfb57225` |
| USPSA | `535fb6bd-9a9e-4cdc-8574-ebf61e43e13d` |
| My OKRs | `d759151f-8a6c-4c28-9fe1-db303f4ecf3a` |
| Keeply | `39450371-6432-4700-8f15-20fcd9ca2068` |

**Task lists** (global, no space): App Bugs `ed6849b4-…`, HQ Notes `1102a12c-…`,
Keeply `efd02fa2-…`, Supplies `679e9e5f-…`, Admin & Compliance `67d8f402-…`, Reading `fa93467f-…`.

**Todoist** (retired at runtime; originals may still exist for archival): boat projects are
out of scope (`6Xh2cH9Hf3JPf9jH` maintenance, etc.). OKRs project stays native.

---

## DB schema

```
spaces
  ├── annual_objectives (space_id)  .notes DORMANT (→ objective_logs)
  │     ├── roadmap_items (space_id, annual_objective_id)
  │     │     .health_status: not_started|backlog|on_track|off_track|blocked|done
  │     │     ├── weekly_actions (roadmap_item_id)  .estimated_minutes
  │     │     ├── habit_checkins / metric_checkins (UNIQUE roadmap_item_id, week_start) / daily_checkins
  │     ├── objective_links (objective_id)
  │     └── objective_logs (objective_id)
  ├── weekly_reviews (space_id) UNIQUE(space_id, week_start)  .closed_at (NULL=draft)
  ├── tasks (space_id XOR list_id; BOTH NULL = unified Inbox)
  │     .roadmap_item_id (KR link) · .parent_task_id (subtasks) · .section_id
  │     .priority 1–4 · .estimated_minutes · .deadline_date · .due_date + .due_time
  │     .recurrence_text + .recurrence_rule (jsonb, both-null or both-set) · .completed_at
  ├── task_lists — GLOBAL, no space_id
  ├── task_sections (list_id XOR space_id)  CHECK one_parent
  ├── notebooks (space_id)  .parent_notebook_id (nesting)
  ├── notes (space_id NULLABLE)  .notebook_id (NULL+NULL space = Inbox)  .body jsonb (TipTap)
  └── share_tokens (space_id NULLABLE; NULL = all-spaces)

calendar_capacity_blocks — weekly template. space_id NULL=any, kind, label,
  day_of_week 0=Mon..6=Sun, start_minute/end_minute (mins from midnight), sort_order.
calendar_blocks — scheduled placements. **at most one** of task_id/weekly_action_id (was XOR;
  relaxed Jun 20 via `relax_calendar_block_source_for_freeform_events` so agent free-form events
  with neither are valid), space_id,
  capacity_block_id, title, block_date, start_minute/end_minute,
  google_event_id, google_calendar_id, status 'proposed'|'committed'.  RLS USING(true), NO user_id.
user_google_tokens — user_id (UNIQUE, FK auth.users), access_token, refresh_token,
  expires_at, scope, read_calendar_ids text[], hq_calendar_id.  RLS auth.uid()=user_id.

(root) task_tags (task_id, tag) · note_tags (note_id, tag) — global tag namespaces
```

**RPC:** `find_active_share_token(p_token text) RETURNS json` — SECURITY DEFINER, anon-callable.

---

## Theme

Night-watch palette propagated app-wide; dark/light legacy semantic tokens
(`--teal/red/amber/slate-bg/text`) are re-pointed in `globals.css`. Identity tokens used
directly in components: `--nw-label` (amber instrument labels, `.16em`), `--nw-cream`,
`--nw-hero-amber`, `--nw-alarm/caution/nominal/standby-text`. Cobalt `--accent` for all
interactive elements. Per-space object colors:
`#0ea5b8 #14b87f #c8a040 #d4885a #c44a7c #8b5cf6 #6b8caa #5b8def`.
