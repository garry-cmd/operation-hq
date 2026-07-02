# Operation HQ — CONTEXT

> **Single source of truth.** Read this first; update once at session end.
> Historical session-by-session detail lives in `docs/operation-hq-pickup-notes.md`
> (retained for history, no longer the working doc) and the dated
> `docs/operation-hq-session-*.md` logs. Last updated: **Jul 1, 2026 (Home redesign + mobile polish)**.

---

## What this is

A single-user life-management + OKR system. Desktop-first, used many times a day.
Modules: **Home** (objective spine + **Vitals** band [metric/habit flip cards] + **Focus-this-week** action band + space filter + weekly-close strip; default landing) ·
**Chief of Staff** (AI agent, voice) · **Home + Roadmap** (strategic — work the plan / shape the plan) · **Tasks + Notes + Calendar**
(daily) · **Reflect** (per-space weekly ritual hub — Plan + Close + archive) · **Settings** ·
**Parking** (archive). Proactive web-push briefings layer on top. Garry is the sole user
(Mel/multi-user is deferred indefinitely — see Backlog).

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
column** on app tables. `spaces` has RLS disabled. Exception: `user_google_tokens` scoped
`auth.uid() = user_id`. Server routes must **not** filter app tables by `user_id` — the
column doesn't exist.

**Env (Vercel Production):** `ANTHROPIC_API_KEY` · `DEEPGRAM_API_KEY` + `ELEVENLABS_API_KEY`
(+ optional `ELEVENLABS_VOICE_ID`) · `VAPID_PUBLIC_KEY` + `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
(same value) + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` (`mailto:garry@keeply.boats`) ·
`CRON_SECRET` · Supabase URL/anon/service-role. `NEXT_PUBLIC_*` inlined at BUILD time.

---

## Current state — shipped

### Jul 1 session 2 — Home redesign + mobile overflow fixes

**Home card polish + visual hierarchy overhaul (`components/Home.tsx`):**
- **Objective cards** — `navy-800` + `var(--card-shadow), var(--card-inset)` (matches Tasks card treatment; was `var(--surface)` + generic shadow)
- **Action column items** — mini-cards (`surface` bg + `line` border + `border-radius:9px`) instead of flat text rows
- **Vitals** — two grouped containers (Metrics / Habits) each in their own `navy-800` card with amber label + rule; replaces flat strip
- **Focus this week** — single `navy-800` card with `border-top` space-group dividers inside; replaces flat `.sgrp` list. Space headers now just a compact label row inside the card
- **Space group headers** in Objectives — `border-bottom: 1px solid var(--line-2)` + amber `nw-label` color; was dim and easy to miss when scrolling
- **Quarter pill in header** — subtle amber badge (`rgba(200,160,64,.08)` bg + border); was plain text
- **Close the week removed from Home** — belonged in Reflect; `reviews`, `weekForSpace`, `onCloseWeek` props removed from Home entirely. Reflect already had the same wiring

**Focus row redesign (mobile-first):**
- Checkbox: 18px ring inside a 44px invisible `fcb-wrap` touch target — no more oversized filled green bubbles on mobile (was `min-width:36px;min-height:36px` override inflating the circle)
- Row structure: title line + subordinate `frow-sub` line (space-colored dot + KR name in muted mono, no border box; carried badge)
- backlog/delete controls: hidden on mobile (`frow-desktop-only`), appear on desktop hover only

**Mobile overflow fixes (expanded objective cards):**
- `ocard`: `min-width:0` so flex column parent can constrain it
- `exp`: `max-width:100%` at base; `width:100%` on mobile
- `rail`, `kr-col`, `act-col`: `width:100%;box-sizing:border-box` on mobile
- `kr-head`: `flex-wrap:wrap` on mobile; `kt` title gets `flex:1 1 100%` so it takes its own line, pushing status chips below instead of forcing the card wider
- `home`: `overflow-x:hidden` backstop

**Collapsed card mobile fix:**
- `col-row` wraps to 2 lines: name + % on line 1, pills full-width on line 2
- `prog-bar` and `pacechip` hidden on mobile (redundant with the % number)

**Data fix — 3Q2026 KRs stuck as `planned`:**
- Quarter roll SQL (Jun 28) moved KRs to 3Q but left `status='planned'`. `getActiveKRs` filters these out, so Home board and Vitals showed nothing.
- Fixed via SQL: `UPDATE roadmap_items SET status='active' WHERE quarter='3Q2026' AND status='planned' AND is_parked=false` — 44 rows updated.

### Jul 1 session — Tasks screen built + mobile UX overhaul (Evernote/Todoist-informed)

Long session, ~18 deploys. Theme: bring mobile to parity, build Tasks from scratch, restyle toward Evernote (Notes) and Todoist (Tasks) patterns Garry shared as screenshots.

**Tasks — new module (was DB table + types only, no UI):**
- `lib/db/tasks.ts` created: `listAll`, `create`, `update`, `toggleComplete` (recurring tasks advance `due_date` by rule instead of completing), `remove`, `listTagsForTasks`, `setTags`.
- `components/Tasks.tsx` created: scope chips (Today/Overdue/Inbox/All/per-space/**per-tag**), due-bucketed sections (Overdue/Today/Upcoming/None/Done-collapsed), optimistic toggle/delete.
- **Todoist-style card rows** — rounded `--navy-800` cards w/ `--card-shadow` tokens (both themes), 30px circle checkbox whose **ring color = priority** (P1 alarm / P2 caution / P3 accent / P4 navy-500), 16.5px wrapping title, one-line **description preview**, **`KR: <title>`** readable sub-line (the alignment moat, replaced the 10px chip), meta line = calendar icon + "Due 5 days ago" + ↻ + **space name** (new; cross-space scopes now show origin) + inline `#tags`. Done cards fade to .55.
- **Description field** — textarea in detail sheet (column already existed; no migration).
- **Detail sheet (`TaskDetailSheet`)** — title, description, due quick-picks, P1–P4, **Tags editor** (accent chips + × ; add via Enter/comma/blur; backspace pops; existing-tag **fast-scroll suggestion row** filters as you type), space chips, linked-KR select, delete. Optimistic save w/ rollback.
- Creation via persistent dashed **"＋ Add task"** ghost card at list bottom (swaps to inline create in place). Removed `+ New` and `→ Today` header buttons per Garry.
- **Tag system integration** — `task_tags` shares global namespace with `note_tags`; tag scope slices tasks cross-space. This is the filtering unlock (`#waiting`, `#errand`, `#deep-work` as context lists).
- Data audit: 146 tasks / 117 open / 15 overdue, all real (VidScrip, Keeply, My OKRs, USPSA). No cleanup needed.

**Mobile navigation — replaced hamburger/drawer with floating pill bottom nav:**
- 6 tabs: Home · Notes · Tasks (overdue badge) · Roadmap · Agent · Me. Evernote-style floating rounded pill (blur, shadow, tinted `--accent-dim` bubble behind active icon, theme-aware). NavRail hidden entirely on mobile (`<900px`); desktop unchanged. Dead `drawerOpen` state removed.
- **Me** profile tab (`'profile'` screen): avatar/email header + grouped menu (Screens: Reflect/Parking/Files/Tags · Preferences: theme toggle, Settings · Account: share, sign out). Highlights for all sub-screens via `profileSubs`.

**Notes — Evernote-style mobile:**
- Opens directly to **Browse** (run-once effect keyed to isMobile). Browse = big rows (Inbox/All + expandable space stacks + notebooks + tags), dedicated full-screen in the aside; desktop sidebar gated behind `{!isMobile}`.
- **Search screen** (new `NoteSearchScreen`) — magnifier in Browse + list headers. Full-screen: autofocus input, back arrow, clear. Zero-query state = recent searches (localStorage, last 5) + notes grouped Last 7d/30d/Earlier. Live results across title + body (`extractNoteText`) + tags, title hits first, cap 40, Space›Notebook breadcrumb. `z-70` (above Browse `z-40`), iOS selection-callout suppressed. **Note:** searches globally regardless of browse scope (intentional, matches Evernote).
- Fixed: Browse sheet (`z-60`) was covering bottom nav (`z-50`) → dropped Browse to `z-40`, padded bottom 96px for pill clearance.
- NoteEditor: focus-mode toggle hidden on mobile (editor already fullscreen; back bar handles exit).

**Home:** "Close the week" section now **collapsible** (sec-hdr pattern, `hq-home-closes-open`, default open). Section-header + checkbox tap targets already fixed Jun-prior.

**App icon:** blue lightning bolt → **nautical compass rose** (amber north needle, cobalt points, instrument bezel on deep navy `#0d1424`). PIL-generated at 1024px → `public/icon-512/192/apple-touch-icon.png`. iOS caches Home Screen icon — delete/re-add to refresh.

**Light mode:** page bg → **`#f7f9fc`** (Option D, Evernote-flat near-white; was `#e7ebf2`). `--navy-900` + `--bg` + `themeColor` synced. Chose via side-by-side mockups. Task date picker `colorScheme` unlocked from dark → `'light dark'`.

**Mobile sweep:** primary text inputs → 16px (task create/detail, FastCapture, Agent composer — prevents iOS zoom); tap targets enlarged (inline-create Add/✕, Notes header buttons 26→30px, ⋯ menu); nav badge → `--nw-alarm-text` token.

**Tasks — Todoist-style card rows + description + tags (later in session):**
- Rows became rounded cards (`--navy-800` + `--card-shadow`, both themes); done fades .55. 30px circle checkbox ring = priority; `KR: <title>` readable sub-line; one-line description preview; meta line = calendar icon + due phrase + ↻ + space name + inline `#tags`.
- **Description** field (textarea in detail sheet; column pre-existed, no migration).
- **Tag system** — `lib/db/tasks.ts` `setTags`; shared global namespace with `note_tags`. Detail sheet Tags editor: chips + ×, **tap-to-open picker** (dashed "+ Add tag" opens a panel with existing tags as a tappable wrapped grid + filter/create input — keyboard only when creating, not on first tap; earlier auto-focus-input version was the bug). Scope chips gain a `#tag` chip per tag in use (most-used first); tag scope slices tasks cross-space. This is the filtering unlock.
- Removed `+ New` and `→ Today` header buttons; creation via persistent dashed "＋ Add task" ghost card at list bottom.
- **Detail sheet swipe-to-dismiss** — drag the grabber (40×5, 44px hit zone) down past 110px to close; backdrop tap + swipe both now **commit edits on the way out** (bottom-sheet convention). This fixed the tag-persistence bug: previously only the explicit Save button persisted, so adding a tag then leaving discarded it. `buildTags()` also folds an uncommitted tag draft into the save.
- **Checkbox dead-tap fix** — 30px ring wrapped in a 44px hit area + `stopPropagation` (taps just outside the circle did nothing before).

**FAB (FastCapture):**
- New **Task** capture type (nearest the thumb): title + Due chips (No date/Today/Tomorrow) + optional space/Inbox; creates via `tasksDb.create`, lands on Tasks screen. Distinct from "Action" (weekly_action→KR).
- **Note capture now opens the created note in the real editor** (`setNotesInitialId` + `screen='notes'`) instead of toasting — was a quick-capture dead-end resembling the objective-log box.
- **z-index fix** — capture sheet was `z-48` under the pill nav `z-50`, hiding the Save button behind the nav. FAB layer lifted above: backdrop 51, sheet 52, dial 53, FAB 54.

**Home:** "Close the week" section now collapsible (`hq-home-closes-open`, default open).

**App icon:** lightning bolt → nautical compass rose (amber north, cobalt points, instrument bezel, deep navy). PIL-generated. iOS caches — delete/re-add Home Screen icon.

**Light mode:** page bg → `#f7f9fc` (Evernote-flat near-white). `--navy-900` + `--bg` + `themeColor` synced. Task date picker `colorScheme` → `'light dark'`.

**Mobile sweep:** dead `drawerOpen` state removed; text inputs → 16px (task/note/FastCapture/Agent, prevents iOS zoom); tap targets enlarged; nav badge → `--nw-alarm-text`. NoteEditor focus-mode toggle hidden on mobile.

### Jun 28 session 2 — Todoist backlog: 7 items shipped

**Bugs fixed:**
1. **Roadmap objective span wrong with planningOffset** — `scopeSpan` was using `ROLLING` (anchored to `ACTIVE_Q`) to compute column positions, but the visible columns are `PLANNING_ROLLING` (shifted by offset). Fixed: `scopedQuarters` now accepts a `rolling` param and is called with `PLANNING_ROLLING` everywhere inside the Roadmap component. Also fixes the "Improve Spanish" objective not spanning 1Q2027+2Q2027 correctly at offset=1.
2. **Habits not interactive in Close Week wizard** — habits section was read-only dots. Now shows clickable M/T/W/T/F/S/S buttons per habit; tap to log/remove a checkin; future days disabled. `setHabitCheckins` threaded through `CloseWeekWizard` Props → `Step1` Props → `page.tsx` call site.
3. **Roadmap planning offset stuck** — offset was hardcoded to `useState(1)`, ▶ was clamped to max 1. Replaced with: `useState(0)` (default), persisted in `localStorage('hq-roadmap-offset')`, fully manual ◀ ▶ nav buttons in Roadmap header, no auto-advance on quarter seal. ▶ and ◀ roam freely (no clamp). Center pill shows `⚡ 2Q2026` to snap back when offset ≠ 0.
4. **Home metric/habit vitals cards not showing** — `vitalsOpen` defaulted to `false` (collapsed). Changed to `useState(() => loadLS('hq-home-vitals-open', true))` so vitals open by default; toggle state persisted in localStorage.
5. **FAB action picker only showed 2Q KRs** — `getCurrentQuarterKRs(roadmapItems, ACTIVE_Q)` was hardcoded to `ACTIVE_Q = 2Q2026`. After quarter roll all 3Q KRs were invisible. Fixed: changed to `getActiveKRs(roadmapItems).filter(k => !k.is_habit)` — shows all active KRs regardless of quarter.
6. **Home light-mode washed-out** — cards blended into page background, progress bars invisible. Added a `[data-theme="light"]` overrides block in Home's `<style>`: metric/habit/objective cards get `background:#fff` + real box-shadow + `border-color:#c0c9d7`; progress bar tracks `#d2d9e5`; primary text `#1a2033`; muted text `#71778a`/`#96a0b2`.

**Features shipped:**
7. **`is_habit` toggle in EditKRModal** — checkbox "Track as a habit" added alongside the metric toggle; mutually exclusive (enabling one clears the other); when habit is on, date fields and quarter-bound toggle are hidden; `is_habit` patched to DB on save.
8. **KR drag-to-reorder within a quarter column** — replaces the ▲▼ buttons. Dragging a chip within the same quarter column shows a cobalt insertion line between chips. Drop performs an optimistic reorder (sequential `sort_order` 0,10,20…) and writes all affected chips to DB in parallel. Cross-column drags (different quarter) still work as before. `dragOverChip` state added. ▲▼ buttons and `onMoveUp`/`onMoveDown` props removed from `KRChip`.
9. **Week number + days left in quarter in Home header** — `W26` and `2d left` (amber when ≤14 days) appear next to the quarter label. ISO week number computed inline.
10. **Quarter close button in Reflect** — "Quarter" card between Plan & Close and the Weekly archive. Shows "Close quarter →" button or "✓ sealed" if already sealed. `onQuarterClose` optional prop added to `Reflect`; wired from `page.tsx`.
11. **Quarter close Step 1 grouped by space** — in all-spaces mode, KR scoring groups objectives under amber space-name section headers with color dot and divider rule.

### Jun 28 session 1 — Quarter close, habit snapshots, roadmap roll, Home displayQ

**Manual quarter roll (2Q→3Q).** 27 open KRs moved from `2Q2026` → `3Q2026` via SQL. Done/failed KRs left on 2Q as historical record.

**`ACTIVE_Q` is now date-derived.** `lib/utils.ts`: `deriveActiveQuarter()` computes current quarter from today's date. Flips to 3Q automatically on July 1 2026.

**Roadmap waterfall Gantt view.** Full rewrite of `components/Roadmap.tsx`: single shared 4-column CSS grid; objective headers span only their date-scoped quarters; collapse toggle per objective; delete objective button; auto-expand on KR drag; date inputs turn accent blue when filled; live quarter preview below.

**Roadmap capacity planning.** T-shirt sizing (S/M/L/XL), effort button on KR chips, summary bar with load gauge. DB: `effort_size text CHECK (effort_size IN ('S','M','L','XL'))` on `roadmap_items`.

**Quarter close wizard — KR disposition step.** Step 3 "Wrap Up KRs" inserted (wizard now 5 steps). Non-done KRs get mandatory decision: Done / Carry / Abandon.

**Quarter close wizard — habit snapshot + reset on seal.** New table `quarter_habit_snapshots`. At seal: counts checkins, writes snapshot, resets habit KRs to `not_started`/`progress=0`. 2Q2026 backfilled manually.

**Quarterly close history in Reflect.** `QuarterReviewCard` shows PROUD OF / DIDN'T GO / NEXT QUARTER / NOTES + habit bars.

**Home `displayQ` — sealed quarter advance.** When `ACTIVE_Q` is sealed, `displayQ` advances to next quarter. All downstream surfaces use `displayQ`. `displayQHabitCheckins` clamps to `displayQ` start when sealed. `activeQSealed` memoized from `quarterReviews`.

**Space edit/delete.** `SpaceSwitcher.tsx`: pencil on all spaces, edit form, delete with cascade confirm.

**Bug fixes (from Todoist backlog session 1).** Home delete action; done/failed KRs filtered from board; mobile Notes height fix; CloseWeekWizard pill borders + `failed` status; FastCapture space-first KR filter.

### Jun 27 — Tauri desktop app shipped + autonomous deploy workflow

**Autonomous deploy workflow established.** Claude pushes directly to GitHub via session-scoped PAT; Vercel auto-deploys; Claude polls via Vercel MCP until READY.

**Tauri Phase 2 SHIPPED.** Architecture: Tauri shell loads `tauri://localhost` (local `dist/index.html`), which renders `hq.svirene.com` in a fullscreen iframe. Shell listens for HQ_PING/HQ_PICK_FILE/HQ_PICK_FOLDER/HQ_SHELL_OPEN from the iframe; posts HQ_REPLY back. `lib/tauri.ts` detects Tauri via `HQ_TAURI_READY` message (synchronous, no async ping). Desktop repo: `garry-cmd/operation-hq-desktop`.

**Hard-won lessons:** WKWebView blocks `fetch()` and `invoke()` from remote HTTPS pages (OS-level WebKit constraint). Only working pattern: shell at `tauri://localhost`, app in iframe, postMessage IPC. `postMessage` to `tauri://localhost` parent must use `'*'` as target origin.

---

## Open follow-ups / tech debt (newest first)

- **Tag suggestions in Tasks are task-tags only** — `note_tags` share the namespace but aren't threaded into `Tasks`. Small prop-thread to also suggest note-only tags in the sheet's picker.
- **Swipeable board columns for Tasks (deferred).** Todoist screenshot showed one-space-per-column horizontal board; Tasks uses scope chips instead. Structural, not styling — its own session if wanted.
- **Task detail sheet unsaved-edit model** — dismissing now auto-commits (good). No explicit Cancel/discard path; if a discard-on-dismiss option is ever wanted, add it. Not currently a problem.
- **Evernote `--repair` re-import** — run `node evernote-migrate.mjs ~/Desktop/ --repair` to restore 194 table-containing notes. Script on Desktop. 194 placeholder notes already deleted from DB.
- **`roadmap_items.effort_size`** — column exists, all NULL. Garry needs to populate via Roadmap.
- **Issue 2 Phase B — weekly-update ritual (deferred).** Phase A gave actions inline update threads; Phase B makes "weekly update" first-class with week-grouped logs + Close Week tie-in.
- **Action update thread only on Focus band** — not yet on per-objective action column rows.
- **Space deep-links land on Home unfiltered** — ⌘K "go to a space" routes to Home but doesn't set `hq-home-space-filter`. ~15min.
- **`ObjectivePanel` is desktop-drawer only** — no mobile treatment.
- **Daily metric logging** (parked) — rename `week_start` → `entry_date` (~4–8 reader files), log modal defaults to today, Close Week reads latest reading in the week. One migration + ~4 files.
- **Image node-level storage GC** (Notes) — deleting an image mid-edit doesn't GC until note delete.
- **Push dedupe subscriptions** — same machine can leave multiple rows; self-heals on send.
- **iOS web push** needs PWA added to Home Screen first.
- **7am cron not yet verified unattended** — first natural 14:00 UTC fire hasn't been observed.
- **Orphaned `components/PushSetup.tsx`** — nothing imports it. Delete when convenient.
- **Rotate voice keys** — `DEEPGRAM_API_KEY` + `ELEVENLABS_API_KEY` transited a chat session.
- **Rotate `SUPABASE_SERVICE_ROLE_KEY`** — transited a chat session during setup.
- **Migrations applied via Supabase MCP aren't repo files.** Fine operationally.
- **`APP_TZ` hardcoded to `America/Los_Angeles`** (`lib/google.ts`). Calendar blocks assume Pacific.
- **Calendar drag has no auto-scroll** near grid edges.
- **Audit #4** — extract `useSpaceData(activeSpaceId)` hook. **Audit #5** — `lib/tokens.ts`.

---

## Backlog / roadmap

### 🔴 Next-session candidates
1. **Scout agent `read_note` server-side tool** — top next-agent-session candidate.
2. **Re-plan button decision** — currently opens legacy `PlanWeek` modal. Likely delete. ~10min.
3. **Subtasks UI polish** — `parent_task_id` shipped on Tasks.
4. **Agent — postponed mutation tools** — `delete_task`/`delete_note`/`delete_kr`; calendar event edit/delete; autonomy rung 3.

### 🟡 Feature backlog
5. `useSpaceData` hook (audit #4). ~1hr.
6. "Plan your first week" for empty spaces.
7. Quarter-close summary when rolling 4Q window advances. ~3–4hr.
8. Recurring-action visual badge on Home action rows. ~30min.
9. Drag to reorder objectives (`sort_order` exists). ~2hr.
10. Drag to reorder tasks (`sort_order` exists). ~2hr.
11. Extract shared `TAG_STYLE`/tag picker (dup'd in `Home`, `ActionPanel`, `Tasks`). ~30min.
12. Propagate done-KR treatment beyond Roadmap. ~1hr.
13. Metric-card pace-aware status. ~1–2hr.
14. Responsive `ActionPanel`/`ObjectivePanel`. ~2hr.
15. **Calendar:** per-user timezone; all-day event handling; recurring HQ blocks; DnD edge auto-scroll.

### 🟢 Nice to have
Share-page query optimization · PWA install prompt · more keyboard shortcuts · Reflect history sparkline.

### ❄️ Deferred indefinitely
- **Multi-user SaaS-ification** — needs real RLS, `spaces.owner_user_id`, invite/signup, role-aware UI. 8–20hr, planning doc first.
- **RLS hardening pass** — `spaces` RLS disabled; others `owner_all USING (true)`. Fine solo.

### Parked / open decisions
- **Todoist + Evernote as external surfaces (Jun 26 decision).** Native Tasks/Notes stay but Todoist/Evernote are primary daily surfaces. HQ links to them from objective cards.
- **`annual_objectives.notes` column** — dormant, replaced by `objective_logs`. Drop someday.
- **Notes editor** — TipTap, locked.

---

## Conventions

1. **Cobalt accent = interactive vocabulary; night-watch = status display.**
2. **Global token re-pointing as a propagation lever** — re-point tokens in `globals.css`, not per-component edits.
3. **`flex:1` + `minHeight:0` for fill-remaining-viewport on mobile.**
4. **Hard refresh after deploy** (Cmd+Shift+R) when touching `globals.css` or big restructures.
5. **`onPickResult` callback over `onScreenChange`** when results carry deep-link payload.
6. **"Does the underlying need still exist?"** before building a backlog item.
7. **Schema-before-code** — apply + verify migrations before writing the code that uses them.
8. **Single-user RLS reality** — app tables have no `user_id`; never filter them by it server-side.
9. **Supabase Postgrest errors are NOT `instanceof Error`** — extract via `(e && typeof e === 'object' && 'message' in e) ? String(e.message) : 'error'`.
10. **DB row before external API call.** Insert DB first, THEN call external service; roll back on failure.
11. **Agent tools are propose-first.** Renders a confirmation card, only mutates on Approve.
12. **Reuse the canonical mutation path in the agent** (e.g. `tasksDb.toggleComplete` so recurring tasks roll forward).
13. **Persistent web push = re-ensure on load.** Idempotent re-register on every app load when permission granted.
14. **Build-time env + paid-tier gotchas.** `NEXT_PUBLIC_*` inline at build. ElevenLabs free tier 402s on library voices.
15. **Type system = Space Grotesk / Inter / JetBrains Mono via `next/font`.** Never redefine `--font-*` in `:root`.
16. **Sandbox build can't fetch Google Fonts.** Use `npx tsc --noEmit` to verify; only `/hq` prerender error is the known false positive.
17. **`minmax(0,1fr)` for grid tracks holding wide content** — prevents overflow past sibling tracks.
18. **Sticky view-state via localStorage** (`hq-home-*` keys, SSR-safe `loadLS<T>(key, fallback)`).
19. **Objective-spine + page-level panels.** `ObjectivePanel` is a page-level drawer (`openObjectiveId` lifted to `page.tsx`).
20. **`scopedQuarters` must use `PLANNING_ROLLING`, not `ROLLING`** — the visible grid columns are `PLANNING_ROLLING`; using `ROLLING` (anchored to `ACTIVE_Q`) causes objective header spans to be wrong at any non-zero planning offset. Always pass the local `PLANNING_ROLLING` variable when computing which quarters an objective covers in Roadmap.
21. **FAB `activeKRs` must use `getActiveKRs`, not `getCurrentQuarterKRs(ACTIVE_Q)`** — after a quarter roll `ACTIVE_Q` still points to the old quarter until July 1. `getActiveKRs` returns all non-parked/non-abandoned KRs regardless of quarter, which is the correct set for the action picker.
22. **Quarter roll must set `status='active'`** — the roll SQL moves KRs to the new quarter but `status` stays `'planned'`. `getActiveKRs` filters out `'planned'`, so Home board + Vitals show nothing. After any quarter roll, run: `UPDATE roadmap_items SET status='active' WHERE quarter='<NQ>' AND status='planned' AND is_parked=false`.
23. **Home mobile overflow pattern** — flex children in column-direction flex need `width:100%;box-sizing:border-box` AND `min-width:0` at every level to prevent intrinsic sizing from escaping the card. `overflow-x:hidden` on the page container is the last-resort backstop.

---

## Deploy workflow (autonomous — Jun 27+)

Claude pushes directly to GitHub via PAT; Vercel auto-deploys on push to `main`; Claude polls `Vercel:list_deployments` until `READY`.

**PAT:** Stored in Claude memory — no need to paste at session start. Rotate here when refreshed.

**Git identity:** `user.email=garry@svirene.com` · `user.name=Garry Hoffman`

**Claude's deploy loop:**
1. Clone: `git clone --depth 1 https://garry-cmd:<PAT>@github.com/garry-cmd/operation-hq /tmp/operation-hq`
2. Make changes in sandbox
3. Verify: `npx tsc --noEmit 2>&1 | grep -v "validator.ts\|next/server\|Cannot find module\|@types/node"`
4. Commit + push: `git config user.email garry@svirene.com && git config user.name "Garry Hoffman" && git add -A && git commit -m "..." && git push https://garry-cmd:<PAT>@github.com/garry-cmd/operation-hq HEAD:main`
5. Poll `Vercel:list_deployments` (projectId `prj_rgWkigVjdCzawkB3g00GqTIMFTEC`, teamId `team_FD2H6R0bDq59mIOZWsPE8YLg`) — sleep 50s before first poll; if `ERROR`, pull build logs and fix
6. Garry verifies in the live app

**Re-sync within session:** `git fetch --depth 1 origin main && git reset --hard origin/main` before re-patching files already touched this session.

**Desktop repo:** `garry-cmd/operation-hq-desktop` — Rust/Tauri changes require `cargo tauri build` on Garry's Mac after `git pull`.

---

## Spaces & IDs reference

| Space | space_id |
|---|---|
| Stellar (APT) | `f7f2fdd9-bbf6-4f30-ac1f-bd06b81d7d99` |
| VidScrip | `572f74de-d3bf-4aec-831b-c8c2dfb57225` |
| USPSA | `535fb6bd-9a9e-4cdc-8574-ebf61e43e13d` |
| My OKRs | `d759151f-8a6c-4c28-9fe1-db303f4ecf3a` |
| Keeply | `39450371-6432-4700-8f15-20fcd9ca2068` |
| Irene | `92e0a6df-631e-4bf3-a26a-66d924e21754` |

**Todoist project** "Operation HQ": projectId `6gPfGmw5F7PJ6w2G`, Bugs section `6gxvf447FQRMg4qG`, Features section `6gxvf3mh6Ch26pgG`. Check at session start for work items.

---

## DB schema

```
spaces
  ├── annual_objectives (space_id)  .notes DORMANT (→ objective_logs)
  │     │   .start_date / end_date (date, nullable) — added Jun 19
  │     ├── roadmap_items (space_id, annual_objective_id)
  │     │     .health_status: not_started|backlog|on_track|off_track|blocked|done|failed
  │     │     .effort_size: text CHECK IN ('S','M','L','XL') NULLABLE
  │     │     ├── weekly_actions (roadmap_item_id)  .week_start NULLABLE (NULL = backlog)
  │     │     ├── habit_checkins / metric_checkins (UNIQUE roadmap_item_id, week_start) / daily_checkins
  │     ├── objective_links (objective_id)
  │     └── objective_logs (objective_id)
  │             .roadmap_item_id NULLABLE · .weekly_action_id NULLABLE (ON DELETE CASCADE)
  │             .title · .content · .log_date
  ├── weekly_reviews (space_id) UNIQUE(space_id, week_start)  .closed_at (NULL=draft)
  ├── quarter_reviews (quarter, space_id)  .closed_at · .proud_of · .didnt_go · .next_quarter · .notes
  ├── quarter_habit_snapshots (quarter, space_id, kr_id, kr_title, sessions, expected, percent)
  ├── tasks (space_id XOR list_id; BOTH NULL = Inbox)
  │     .roadmap_item_id · .parent_task_id · .section_id · .priority 1–4
  │     .recurrence_text + .recurrence_rule (jsonb) · .completed_at
  ├── task_lists (global, no space_id) · task_sections (list_id XOR space_id)
  ├── notebooks (space_id)  .parent_notebook_id (nesting, depth 3)
  ├── notes (space_id NULLABLE)  .notebook_id  .body jsonb (TipTap)
  │     .pinned_at · .roadmap_item_id (nullable, KR link)
  │     note_versions (note_id FK CASCADE, title, body, created_at)
  └── share_tokens (space_id NULLABLE; NULL = all-spaces)

calendar_capacity_blocks — weekly template
calendar_blocks — scheduled placements. status 'proposed'|'committed'.  NO user_id.
user_google_tokens — user_id (UNIQUE, FK auth.users), access_token, refresh_token,
  expires_at, scope, read_calendar_ids text[], hq_calendar_id.
push_subscriptions · briefings · tracked_files · file_versions · agent_memory
(root) task_tags (task_id, tag) · note_tags (note_id, tag)
```

**RPC:** `find_active_share_token(p_token text) RETURNS json` — SECURITY DEFINER, anon-callable.

---

## Theme

**Type:** Space Grotesk (`--font-display`) / Inter (`--font-body`) / JetBrains Mono (`--font-mono`) via `next/font/google` in `layout.tsx`. Screen pattern: mono amber eyebrow → display title → mono labels + tabular readouts.

**Color:** night-watch palette, dark/light. Legacy tokens (`--navy-*`, `--teal/red/amber/slate-bg/text`, `--nw-*`) re-pointed in `globals.css`. Light mode: page bg `#e7ebf2`, cards `#fff` with real shadows. Cobalt `--accent` for all interactive elements. Per-space colors: `#0ea5b8 #14b87f #c8a040 #d4885a #c44a7c #8b5cf6 #6b8caa #5b8def`.

**Light mode Home:** `[data-theme="light"]` overrides block in Home's `<style>` gives cards `background:#fff` + box-shadow + `border-color:#c0c9d7`; progress tracks `#d2d9e5`; primary text `#1a2033`; muted `#71778a`.
