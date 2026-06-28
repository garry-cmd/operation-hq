# Operation HQ — CONTEXT

> **Single source of truth.** Read this first; update once at session end.
> Historical session-by-session detail lives in `docs/operation-hq-pickup-notes.md`
> (retained for history, no longer the working doc) and the dated
> `docs/operation-hq-session-*.md` logs. Last updated: **Jun 26, 2026**.

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
column** on app tables (e.g. `calendar_blocks`). `spaces` has RLS disabled. The exception is
`user_google_tokens`, scoped `auth.uid() = user_id` (holds OAuth tokens). Server routes that
touch the DB with the service-role client must **not** filter app tables by `user_id` — the
column doesn't exist. This bit us once (commit route 500'd on a phantom `user_id` filter).

**Env (Vercel Production):** `ANTHROPIC_API_KEY` (agent + briefs) · `DEEPGRAM_API_KEY` +
`ELEVENLABS_API_KEY` (+ optional `ELEVENLABS_VOICE_ID`) for voice · `VAPID_PUBLIC_KEY` +
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` (same value) + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT`
(`mailto:garry@keeply.boats`) for web push · `CRON_SECRET` (Vercel Cron Bearer for `/api/cron/brief`)
· Supabase URL/anon/service-role. **`NEXT_PUBLIC_*` are inlined at BUILD time** — set them before
the build, and force a clean rebuild (`git commit --allow-empty`) when an env value changes but the
running deployment can't see it.

---

## Current state — shipped

### Jun 27 — Tauri desktop app shipped + autonomous deploy workflow

**Autonomous deploy workflow established.** Claude now pushes directly to GitHub via a session-scoped PAT; Vercel auto-deploys; Claude polls via Vercel MCP until READY. No bash blocks for Garry to run. Desktop repo created: `garry-cmd/operation-hq-desktop`.

**Tauri Phase 2 SHIPPED — native picker + shellOpen working.**

- **Architecture (final):** Tauri shell loads `tauri://localhost` (local `dist/index.html`), which renders `hq.svirene.com` in a fullscreen iframe. Shell is the trusted Tauri origin; iframe communicates via `postMessage`.
- **`dist/index.html` (shell):** listens for `HQ_PING`, `HQ_PICK_FILE`, `HQ_PICK_FOLDER`, `HQ_SHELL_OPEN` from the iframe; calls `window.__TAURI__.core.invoke()`; posts `HQ_REPLY` back. Also forwards `hq:capture` Tauri events into the iframe as `HQ_EVENT` messages. Sends `HQ_TAURI_READY` on iframe load.
- **`lib/tauri.ts` (web app):** sets `_isTauri = true` synchronously when `HQ_TAURI_READY` is received (no async ping). All picker/shellOpen calls go via `window.parent.postMessage('*', ...)`. `onTauriEvent` listens for forwarded `HQ_EVENT` messages.
- **`normalizeUrl` fix:** local paths starting with `/` now pass through unchanged. One corrupted `https:///Users/...` row cleaned in DB.
- **`ObjectivePanel` fix:** link chip clicks now use `shellOpen()` instead of `window.open()`.

**Hard-won lessons (record for future sessions):**
- WKWebView blocks `fetch()` and `invoke()` from remote HTTPS pages regardless of capability config — OS-level WebKit constraint, not fixable in Tauri config.
- Custom URI scheme handlers (`hq://`) are also blocked from HTTPS origins. Same root cause.
- `initialization_script` still doesn't help — IPC ACL gates on window origin.
- **Only working pattern:** shell serves from `tauri://localhost`, app in iframe, postMessage IPC.
- Tauri detection: listen for `HQ_TAURI_READY` on module load (before any component mounts). Async ping has a race condition — the READY message may arrive before the listener is attached.
- `postMessage` to `tauri://localhost` parent must use `'*'` as target origin — browsers reject custom scheme origins. Shell validates `event.origin === 'https://hq.svirene.com'` on its side.

### Jun 26 (session 2) — Notes, Home, and Modal UI refresh

**Notes module — major UI pass:**

- **Notes.tsx rebuilt** — instrument-panel aesthetic: Space Grotesk display titles, mono amber section labels (`LABEL_STYLE`), cobalt accent on selected state, tabular-mono counts. Sidebar uses `SidebarRow` + `SpaceRow` with space color dot + glow, cobalt left-bar on active row. Note list: Space Grotesk titles, preview, mono dates, cobalt tag chips.
- **Table view + stats bar** — view toggle in list header (card ↔ table). Table view has sortable columns (Title / Updated / Created / Tags), amber sort indicator, pinned dot prefix, cobalt selected state. Stats bar always visible: notes count, tagged count, pinned count, latest date.
- **Filter panel** — funnel icon in list header (dot when active). Tags section: multi-select toggle chips (AND logic). Date section: Updated/Created toggle + From/To date pickers with a **MiniCalendar** (month nav, day grid, range highlighting). Stacks on top of scope; composable.
- **SVG icon library** (`components/Icons.tsx`) — all emoji/unicode replaced with stroke SVGs: `InboxIcon`, `LayersIcon`, `NotebookIcon`, `NotebookStackIcon`, `PinIcon`, `TagIcon`, `TodoistIcon`, `EvernoteNotebookIcon`, `DriveFolderIcon`, `EvernoteNoteIcon`, `DriveFileIcon`, `LinkIcon`, `ObjectiveIcon`, `KRIcon`, `ActionIcon`, `NoteIcon`, `ReflectIcon`, `SpaceIcon`, `SearchNotebookIcon`, `ChevronDown`, `ChevronRight`, `Dot`. Swept across: `Notes.tsx`, `Files.tsx`, `FastCapture.tsx`, `Settings.tsx`, `Home.tsx`, `ObjectivePanel.tsx`, `NoteEditor.tsx`, `History.tsx`, `lib/search.ts`, `app/hq/page.tsx`.
- **Evernote table repair** — 194 notes had `[Table]` placeholder bodies from the original ENEX migration. Those notes deleted from DB, `evernote-migrate.mjs` updated with proper TipTap table converter (`table > tableRow > tableCell/tableHeader > paragraph`) and `--repair` flag (only re-imports notes with `<table` in source HTML). Script on Desktop as `evernote-migrate.mjs`; run: `node evernote-migrate.mjs ~/Desktop/ --repair`.
- **NoteEditor header redesign** — breadcrumb bar replacing the flat title-with-icons header: space color dot + `Space › Notebook` path, focus toggle left, save indicator + `⋯` menu right. `⋯` menu consolidates all scattered icon buttons: Pin, Link to KR, Move, Note history, Export .md, Delete. Title input: 30px display-weight, `Title` placeholder. Tags: cobalt mono chips + `+ tag` inline. Toolbar + editor CSS updated to HQ design tokens (`var(--t-0)`, `var(--surface)`, `var(--line)`, `var(--hover)`).

**Home modal — section collapse + Vitals position:**

- **Vitals band moved** above Focus this week (was below objectives). Order: Quote → Vitals (metrics + habit flip cards) → Focus this week → Objectives.
- **All three sections collapsible** — Vitals, Focus this week, Objectives all start **collapsed** by default so the full page fits on one screen. Each section header is full-width clickable; chevron rotates 90° on expand; section meta (count, progress) visible in collapsed header. State: `vitalsOpen`, `focusOpen`, `objectivesOpen` (default all `false`). The "hide done" toggle still works inside the Focus header (stopPropagation so it doesn't collapse the section).

**Modal design system refresh:**

- **`Modal.tsx` rebuilt** — `var(--surface)` background, `var(--line)` border, Space Grotesk title, backdrop blur, Escape-to-close, `×` hover button. Shared CSS injected once: `.m-field`, `.m-label`, `.m-input`, `.m-btn`, `.m-btn-primary`, `.m-btn-danger`, `.m-row`, `.m-hint`, `.m-divider`, `.m-section-label`.
- **`EditObjectiveModal`** — full restyle with new class names, clean layout.
- **`MetricLogModal`** — inline styles updated to new tokens; logic/behavior unchanged.
- **`EditKRModal`** — class names and `--navy-*` tokens swept.
- **`CloseWeekWizard`, `QuarterCloseWizard`, `ActionPanel`, `ObjectivePanel`** — full token sweep (`--navy-50` through `--navy-900`, `--red-text`, `--indigo-*`, `--accent-dim`) replaced with new system. Layout and logic unchanged.

**Irene space added:** `92e0a6df-631e-4bf3-a26a-66d924e21754`, color `#0ea5b8`. Notebooks: Cruising (19 notes), Maintenance (12 notes).

### Jun 26 — Objective external resource links + strategic direction shift

**Strategic decision:** Native Tasks and Notes modules are being replaced by best-in-class apps (Todoist for tasks, Evernote for notes). HQ's role is the strategic layer — OKRs, weekly planning, focus, reflection — with external apps linked to objectives rather than replicated inside HQ.

**Objective external resources (shipped, commit `b6db0ce`).** Each objective card now has a compact resource strip in the rail (below pills) showing linked external resources as emoji chips — ✅ Todoist project, 📓 Evernote notebook, 📁 Drive folder, 📝 Evernote note, 📄 Drive file, 🔗 web link. Click any chip to open in a new tab. No resources yet → a quiet `+ link resources` dashed button opens the ObjectivePanel. In ObjectivePanel, `+ Link` / `+ File` replaced with `+ Resource` dropdown (kind picker → name + URL form). No migration needed — `objective_links.kind` is plain text, no constraint.

Files: `lib/types.ts` (extended `LinkKind` union), `components/ObjectivePanel.tsx` (LINK_KINDS constant, kind picker, unified add form, emoji RefRow), `components/Home.tsx` (`links` prop added, `ObjResources` strip component), `app/hq/page.tsx` (`links` passed into `<Home>`).

**Limitation noted:** URL-paste UX is clunky — correct fix is the Tauri desktop app (see next session). Resource strip left in place; ObjectivePanel links feature pre-existed.

**FinderOpener attempt (not shipped).** Explored a custom `openpath://` URL scheme helper app to open local Finder folders from the browser. Multiple approaches tried (Automator, AppleScript, bash bundle); none worked reliably due to macOS packaging/permissions complexity. Dropped in favor of Drive folder links as interim workaround, with Tauri as the real solution.

### Jun 24 (latest) — Home Vitals (habit flip cards) + OKR pacing/run-rate + Focus this week & per-action update threads

Three builds on the Home component (clone HEAD at session start `1148564`), all mock-before-build (`hq-habit-flip-mock`, `hq-pacing-mock`, `hq-focus-week-mock`, `hq-home-vitals-mock`).

**1 · Vitals band — habit flip cards, dot-rail removed.** Habits now render as flip cards matching the metric cards (shared `flippedM`/`toggleFlip`): front = 4-week rolling % (tone-colored) + sessions/expected·cadence + this-week count + a **directional trend badge** (▲/▼ pts vs the prior 4 weeks); back = the 7-day check-off squares (reuses `checkinSet`/`weekDates`/`toggleHabit`). The old sticky far-right **`.hrail` dot-rail is gone**. The metrics-only band became a **`.vitals`** block with two `.vrow`s (Metrics · ACTIVE_Q / Habits · 4-week rolling); `habitCard(kr)` mirrors `metricCard`. **`lib/habitUtils.ts`:** `calculateRollingAggregate(kr, checkins, weeks=4, endDate?)` gained an optional `endDate` (defaults to now) so the prior-window % can be computed for the trend — backward-compatible, existing callers unaffected.

**2 · OKR pacing + metric run-rate.** Competitive scan (Quantive / Profit.co / Mooncamp / Tability / Weekdone) located the real gap vs other OKR tools = **computed pacing** (time-elapsed vs progress), not hand-set health. On each objective progress bar: an **ideal-pace marker `▾` (`.pm`)** at elapsed-% + a **`.pacechip`** (ahead / on-pace / behind / well-behind / complete) from `progress − elapsed` — ±8 pts = on pace, >20 behind = red (late) else amber. Window = the objective's own `start_date`/`end_date`, else `quarterBounds(ACTIVE_Q)` (16 of 17 objectives are dateless). Module helpers `quarterBounds(q)` + `paceChip(progress, elapsed)`; rendered on **both** the collapsed `.prog-inline` and expanded `.prog`/`.track`. Metric cards gained a **run-rate line** (`.rate`): `need +X/wk → target` from weeks-left to the KR `end_date` (or quarter end), "target met · hold" once past, red/urgent under 2 weeks. Bars bumped 4→6px. **Data fix (not a migration):** the *Net Worth 500k* KR had `target_value=500` with values stored in dollars (~503000) — corrected to `500000` so it reads $503,000 / $500,000.

**3 · Focus this week + per-action update threads (Issue 1 + Issue 2 Phase A).** The Jun 23 rebuild moved actions into per-objective columns and dropped the consolidated view — completed this-week actions still render struck but are tiny, siloed, and fall out once the week rolls. Fix = a **`.focusw` "Focus this week" band** under the quote, above Vitals: every this-week action across objectives, grouped by space (`focusBySpace` memo), full-width rows (checkbox · title · carried · KR tag); **completed kept** (checked, struck, sorted to group bottom) with a `N / M done` counter + bar and a **`hide done`** toggle (`hq-home-hide-focus-done`); fully-done groups skip when hidden. Per-objective action columns untouched.
**Issue 2 Phase A** — `objective_logs` is the unified log substrate (objective-scoped, optional KR scope via `roadmap_item_id`). **Migration `objective_logs_add_weekly_action_id`** adds a nullable `weekly_action_id` FK (**ON DELETE CASCADE** — an action's notes die with it; weekly progress belongs on the KR/objective). Each focus row gets an inline **`▸ note` thread** (`logsByAction` memo; `submitActLog` writes `{objective_id: kr.annual_objective_id, weekly_action_id, content, log_date}` — deliberately **no** `roadmap_item_id`, so it stays action-only and off the KR lane). Objectives (⋯ drawer) + KRs (inline chip) already had threads; this closes the action level. `ObjectiveLog.weekly_action_id` + `NewLogInput.weekly_action_id` added (`create` passes input through, `listAll` is `select('*')`). Files: `components/Home.tsx`, `lib/types.ts`, `lib/db/objectiveExtras.ts`, `lib/habitUtils.ts`.

### Jun 23 — Home board rebuild (grouped 3-col) + discoverable KR controls + Failed status

Iterated the objective-spine Home into a denser board, then made KR mutation discoverable, then added a terminal **Failed** status. Mock-before-build cadence (`hq-home-v2..v7.html`).

**Home board rebuild (`9807124` → `2753a0c` → `2d1f191`).** The spine became a wider (1340px) board. In the All-spaces view objectives are **grouped under `.spacehdr` space headers** (single-space view stays flat). Each objective card expands to **three columns** (`.exp`): a left **rail** (identity, number+bar progress, on/off rollup pills, ⋯ + ✎), the **KR column**, and an objective-level **action column** (`This week` / `Backlog` groups, each action dotted with its KR; `+ action` opens a KR `<select>` then a title input). The action column is hidden when the objective has no actions, so KRs take the full width with a small `+ action` at the bottom of the KR column. **KR logs collapse** behind a `▸ N logs` chip (default hidden). **Metric KR flip cards restored** (front sparkline / back readings list `date · value · Δ` + `+ Log reading`). **Habits moved to a sticky far-right rail** (`.hrail`: name · status · 7 clickable week-dots) — habits/metrics live only in My OKRs, so deliverable-only spaces don't render them. Core: `renderObjCard(g)` + a `board` memo per objective `{obj, fullKRs, miniKRs, actThisWeek, actBacklog, total, done, onN, offN}`. Sticky view state in localStorage (`hq-home-space-filter`, `hq-home-qtr-scope`, `hq-home-obj-collapsed`). **Migration:** `objective_logs.roadmap_item_id` (nullable FK, ON DELETE SET NULL) so logs are KR-scoped on the card (`logsByKR`), not just objective-scoped. The old `.kb-*` band classes are fully gone (rewrite, not patch).

**Discoverable KR controls (`fix(home): collapse logs reliably; add discoverable KR ⋯ menu`).** The hover-only ✎/+log was undiscoverable — status-change and delete *existed* (EditKRModal has both) but were buried. Replaced with: a **clickable status chip** + an **always-visible `⋯` menu** on every KR row → one menu with **Set status** (the six tones, current checked), **Edit details…**, **Add log**, **Delete KR** (window.confirm). The menu is `position: fixed`, anchored to the clicked element's `getBoundingClientRect` (state `krMenu{id,x,y}`, `openKrMenu`), specifically because `.ocard{overflow:hidden}` would clip an absolute dropdown below the last KR row; a `.menu-backdrop` closes it on outside click. Also hardened **log collapse**: `toggleLogs` now tears down an open composer when collapsing (the render gate was `logsOpen || composing`, so a lingering composer kept logs open). Objective delete stays on the always-visible objective ✎ → `EditObjectiveModal` (red Delete) — that path was already reachable; only the KR side was buried.

**Failed terminal status (`5ec1321`).** "Done" shouldn't absorb a miss. New `failed` value across the stack. **Migration `add_failed_health_status`** drops/re-adds `roadmap_items_health_status_check` to include `failed`. `HealthStatus` union gains `'failed'`; Home `HEALTH_TONE`/`STATUS_OPTS`, `EditKRModal` `<option>`, and the share-page `HEALTH` badge (`Failed ✕`) all carry it. Styled as a **terminal miss** — muted red with strikethrough (`.st.t-failed`), deliberately distinct from the brighter, still-recoverable off-track alarm red. Counts as **not-done**, so a missed KR honestly drags objective progress down instead of hiding in the done count.

### Jun 22 — Calendar AI-planner 502 fix + free-form block dedup guard

Two calendar bugs, root-caused live (Chrome MCP + Vercel logs + Supabase).

**AI "Plan my week" was intermittently silent (`planner fix`, commit `2821ea0`).** Symptom: clicking
"Plan my week with AI" did nothing. Root cause: `app/api/plan-week/route.ts` capped Claude's reply at
`max_tokens: 2000`. A real week (~21 items + a long busy block) pushed the JSON answer to that ceiling;
runs that overran truncated mid-string → `JSON.parse` threw → **502 "planner returned unparseable
output"**. The client threw and flashed an easily-missed error toast, so it read as silent. It was
**intermittent** (same payload 502 then 200) because the output hovered right at the boundary — that's
the tell. Fix: `max_tokens` 2000→**8000**, prompt now demands terse reasons (≤8 words) + a 2–4 sentence
rationale to keep output compact, and parse failures now `console.error` the `stop_reason` + raw tail
(and return a clearer "cut off (token limit)" error when `stop_reason==='max_tokens'`). Verified live on
the deployed build: 200, all 21 items placed, rationale + proposed blocks render, "Commit 21 to Google".
NOTE: the greedy **"Quick fill"** planner shares the item pool but not this route — it was never affected.

**Planner time-awareness (both planners).** Separate bug: planning placed items into time that had already
passed (e.g. a 9 AM slot at 2 PM today). `firstFit` had no concept of "now". Fix: `planWeek` and
`planFromAssignments` take an optional `now: {date, minute}`; they synthesize busy intervals from the
week's own window dates that fully block days **before** today and block **today up to the current minute**,
so `firstFit` can never start a placement in the past. Calendar passes `now` from `todayStr` + local clock
at both call sites. No-op when viewing a future week (no window dates ≤ today).

**Free-form calendar blocks could duplicate (`block route` dedup guard).** The agent's
`create_calendar_event` and manual block-add both POST `/api/google/block`, which had **no dedup** — so a
retry / double-click / repeated "set up my week" minted a fresh row + Google event each time. This created
**4× "Gym / Lunch"** blocks per day on Jun 21 (four create passes ~2 min apart, 02:47–02:53), stacked
pixel-perfect on the grid so the × button felt broken (whack-a-mole: remove the top one, three remain).
Fix: an **idempotency guard** in `POST /api/google/block` — before insert, if a *committed free-form*
block (task_id NULL AND weekly_action_id NULL) with the same `block_date`/`start_minute`/`end_minute`/
`title` already exists, return it (`{deduped:true}`) instead of creating a second row + event. The commit
route (`/api/google/commit`) only flips proposed→committed, never creates free-form rows, so it wasn't the
source. **Data cleanup done live** via the app's own DELETE endpoint (DB + Google in sync): 13 duplicate
Gym/Lunch rows removed → exactly one per day Mon–Sat; Tuesday's keeper was lost to a stray × click during
cleanup and recreated via POST. The `note-watch`/agent path that fired the 4 creates wasn't changed — the
guard makes the create idempotent regardless of caller.

**Calendar drag-and-drop rebuilt on pointer events (`Calendar.tsx` WeekView).** The long-carried
"can't drag items on the calendar" bug was native HTML5 DnD: the handlers were *correct* (preventDefault
present, blocks bubble to the column, `resolveSlot` sound), but native drag is unreliable on trackpads
and inside the scroll container — it can fail to initiate or drop silently, which is why it never
reproduced in dev. It also hung the browser automation for 4 min, confirming the mechanism is the
problem. Replaced the entire drag layer: `draggable`/`onDragStart`/`onDragOver`/`onDrop` → pointer events.
`startDrag(payload,kind,spaceId,duration,title,e)` on rail items (`new:key`) and placed blocks (`move:id`)
attaches window `pointermove`/`pointerup`/Esc listeners; columns carry `data-col-date` for
`elementFromPoint` hit-testing (scroll-safe); a `dragRef` mirrors state so listeners read latest without
stale closures. Adds a floating cursor ghost, live valid-window highlighting, and a dashed snap-preview at
the resolved slot. Drop is still gated by `resolveSlot` (must land in a matching capacity window). Works on
trackpad/mouse/touch and is automation-driveable. **Principle:** native HTML5 DnD is a recurring liability
— pointer events are the reliable substrate for any future drag UX. (Garry kept drag over click-to-place.)

**Unscheduled-rail UX (`Calendar.tsx`).** Item titles wrap to two lines instead of single-line ellipsis,
plus a full-name hover tooltip (`title`). Each space group in the rail is a click-to-collapse header
(chevron, count·duration stays visible when collapsed), persisted to `hq-cal-collapsed-spaces`. Cosmetic;
shipped after the readability ask.

### Jun 21 — OKR→Home merge: objective-spine Home, OKR tab deleted (head `2fce55f`)

The OKR tab and Home were fighting; Home absorbed it. End state: **Roadmap = shape the plan, Home = work the plan**, OKR tab gone. Shipped in phases.

**Phase 1 — metrics relocated (`ef07987`).** New `components/VitalsStrip.tsx` (slim mono metric readout) replaces the flip-card "Key metrics" band on Home. The full `MetricKPICard` flip cards + habit % cards moved to a new **Vitals band at the top of Reflect** (all-spaces, current quarter). Home stays lean; Reflect is where you study the numbers. (Supersedes the prior entry's "Key metrics band of flip cards on Home.")

**Phase 2 — objective spine (`df22c55`).** Home's KR board ("In motion / All key results") became an **objective-as-collapsible-card spine** (`renderObjCard` in `Home.tsx`): each objective is a card with a segmented health-rollup bar; **active objectives** (≥1 KR with a this-week or backlog action) start expanded, the rest collapsed. KR rows carry health pill, inline metric readout, this-week/backlog action groups, +action, dive chevron. The gold `.nowline` time-bar is gone — replaced by a **rolling 7-day calendar ribbon** (today + 6, amber "TODAY" tag; `fetchCalendarEvents` repointed to the window). **Sticky view state** in localStorage via SSR-safe `loadLS<T>(key,fallback)`: `hq-home-space-filter`, `hq-home-qtr-scope`, `hq-home-obj-open` (per-objective collapse overrides).

**Overflow fix (`cb9f02b`).** Selecting All/Keeply overflowed horizontally (right rail pushed off-screen, 722px). Cause: the plain `1fr` left track has implicit `min-width:auto` → expands to its widest child (long KR/objective text). Fix: `.hd-body` grid `1fr 380px` → **`minmax(0,1fr) 380px`**. Diagnosed live via Chrome MCP (JS-measured the overflow, proved causation by toggling minmax).

**Phase 3a — edit on Home + ObjectivePanel rehomed (`91f7de2`).** Extracted `EditObjectiveModal` out of `OKRs.tsx` into shared `components/EditObjectiveModal.tsx`. Home gained objective ✎/⋯ + KR ✎ affordances (full create/edit now reachable without the OKR tab) and renders `EditKRModal`/`EditObjectiveModal` in place. `ObjectivePanel` (objective links + dated logs) rehomed as a **page-level right drawer** opened from Home (`openObjectiveId` lifted to `page.tsx`), not an OKR-tab inline panel. Split from 3b to de-risk the destructive cut — 8 links + 7 logs were reachable only through OKRs.

**Phase 3b — OKR tab deleted (`2fce55f`).** Removed `components/OKRs.tsx` + its exclusive child `components/ObjectiveCard.tsx`, the NavRail entry + `OKRIcon`, the `okr` screen type (page + NavRail), the OKRs render branch, and the six OKR-only `space*` derived slices in `page.tsx` (`spaceObjectiveIds/spaceActions/spaceHabitCheckins/spaceMetricCheckins/spaceLinks/spaceLogs`). ⌘K / deep-links rerouted via the generic `handleSearchPick`: objectives open Home's drawer, **active-quarter KRs + actions land on Home and dive into the KR** (Home now consumes `initialKRId`), future-quarter KRs still route to Roadmap. Dropped the `g o` go-key. Copy swept (`manifest.json` + `layout.tsx` description, `FastCapture.tsx` hint no longer say "OKRs"). Roadmap keeps all creation; **Home is the sole work-and-edit surface.**

### Jun 21 — Files/Drive SHIPPED + Home → KR-primary working area (head `93dbe34`)

Multi-deploy session. Two arcs: the Drive-backed Files feature, then a Home redesign making it a real working area (the three "core function" problems Garry hit: orphaned actions, empty-week dead Home, metrics only on the OKR tab).

**Files / Drive (SHIPPED).** Drive-backed client-document tracking.
- **Scope = `drive.file` only** (dropped `drive.readonly` — it's a RESTRICTED scope → Google verification + paid CASA audit on the Production/External app). drive.file is non-sensitive. Tradeoff: no auto folder-watch Inbox; files enter via **Google Picker** (the only way drive.file grants access to existing files — can't paste a link). Service-account + shared-folder is the documented escape hatch if auto-watch is ever wanted.
- **Tables:** `tracked_files` (space_id nullable=Inbox, drive_file_id unique, status `new_in|editing|with_client|sent`, nullable FKs roadmap_item_id/note_id/task_id ON DELETE SET NULL) + `file_versions` (direction `received|sent`, snapshot/source/dest/note). owner_all RLS.
- **Files surface** (`components/Files.tsx`): Inbox/All/per-space sidebar, status chips, version ladder, +Track via Picker, snapshot logging. **NavRail Files entry** (Daily group).
- **Files-on-KR:** Files section in Home's KR work view (tasks column) — +Track links file to KR+space in one gesture, open-in-Drive (↗), unlink.
- New: `lib/db/trackedFiles.ts`, `lib/db/googleApi.ts`, `lib/drivePicker.ts`, `lib/trackViaPicker.ts`, `app/api/google/drive/access-token/route.ts`, `app/api/google/drive/track/route.ts`. `lib/google.ts` gained drive.file scope + `getDriveFileMeta`. Settings "Google & Drive" card with "Grant Drive access" (incremental re-consent).
- **Picker gotchas (resolved):** drive.file Picker selections 404 on `files.get` unless `setAppId` (Cloud project number, = leading segment of GOOGLE_CLIENT_ID before first `-`) is passed — access-token route returns `app_id` for this. "API developer key invalid" was just wrong-origin: the API key is referrer-restricted to `hq.svirene.com/*`, so Picker must be tested on the live domain, not a vercel deploy URL. Env: `NEXT_PUBLIC_GOOGLE_API_KEY`.

**Actions can be unscheduled (Phase 1).** The whole action model was week-anchored; adding an action from the OKR module stamped it with the per-space `weekStart`, which falls back to a **stale `legacyWeekStart`** → action stranded in a hidden week, invisible on Home (which runs on `getMonday()`) and on the OKR card (which only printed a *count*, never listed actions).
- Migration `weekly_actions_week_start_nullable` — `week_start` now nullable. **NULL = unscheduled backlog action** on the KR.
- New KR-added actions (ObjectiveCard + Home) default to **backlog** (`week_start: null`) — can never orphan again.
- OKR card (`ObjectiveCard.tsx`) now **lists** actions per KR in **This week / Backlog** groups (was a bare count); "this week" = real `getMonday()`, not the stale prop. Home KR work view gained the same groups. Both have a `▸ this week` schedule chip and a `backlog` unschedule chip (new module-level `ActionRow` in ObjectiveCard; `scheduleAction`/`unscheduleAction` in both).
- Null-safety: CloseWeekWizard skips backlog in the close walkthrough (also dodges a null `.localeCompare` crash); ⌘K action dedupe null-coalesces.

**Home is a KR-primary working area (Phase 2).** Left board was a week-scoped *action* list → empty week = dead screen. Now it's a **KR board**:
- **In motion this week** — KRs with this-week actions, as expandable cards (this-week + backlog actions inline, schedule chips, inline add).
- **All key results** — every active KR grouped **by objective** (objective-first, space crumb on "All"), compact rows: health pill, metric readout, this-week/backlog counts, hover `+ action`, dive-in chevron. Always populated → never-empty.
- Habits excluded (they live in the rail's Habits tracker). `metricCheckins` prop added to Home for the readout.

**Quarter scope + backlog visibility.** Board defaults to **current quarter** (`ACTIVE_Q`, `getMetricKRs`/inline `quarter === ACTIVE_Q`) with a **This quarter / All** toggle pill in the board head — was leaking 3Q/4Q planned KRs. Backlog actions on non-in-motion KRs now render as **inline sub-rows** under their row in All key results (an added action surfaces immediately instead of hiding behind a count).

**Metrics on Home (Phase 3).** Extracted `MetricKPICard` + `MetricSparkline` (+ format helpers) out of `OKRs.tsx` into shared **`components/MetricKPICard.tsx`** (OKRs lost ~260 lines of dup, imports the shared one). New **Key metrics band** at the top of Home's board — current-quarter metric KRs as the full flip cards (hero value, quarter sparkline, flip-to-readings, `+ Log`), space-filtered, always current-quarter (cards are quarter-anchored, ignore the All toggle). `onLogMetric` wired Home → page's `MetricLogModal`; the modal's KR + checkins lookup now uses the **full** `roadmapItems`/`metricCheckins` (was active-space only) so cross-space logging from Home works. OKRs settles into the structural/editing surface; Home carries the day.

### Jun 21 — Keyboard shortcut layer + Files/Drive plan (design)

**Shipped (live, commit `47b9ed2`)** — global keyboard layer in `app/hq/page.tsx` + `components/FastCapture.tsx`:
- ⌘T → new task, ⌘N → new note. Drive the existing `FastCapture` dial via a new `openRequest` prop (FAB untouched, no duplicated create logic). ⌘-combos fire even mid-typing.
- `g` leader → go-to nav: `h` Home · `t` Tasks · `n` Notes · `o` OKRs · `r` Roadmap · `c` Calendar · `s` Scout · `f` Reflect · `p` Parking. Bare keys are suppressed while focus is in an input / the TipTap editor.
- ⌘K palette unchanged.
- **⌘T/⌘N only fire in the installed PWA** — browser tabs reserve new-tab/new-window (incl. ⌘⇧T/⌘⇧N); `g`-nav + ⌘K work anywhere. Pre-existing watch: TipTap uses ⌘K for links vs. the global palette.
- **Cheat-sheet note** inserted live into `notes` (pinned, Inbox, id `34f2eb73-c93e-46fd-a041-50d5c7ff3fd7`) — a real note, not a coded overlay, by Garry's call. **Drift risk: that note must be hand-updated if the bindings ever change.**

**Decisions this session (no code):**
- **FAB stays.** Killing it was considered; ⌘K is search-only (not a create surface), so nothing absorbs from-anywhere capture yet. Future options: slim FAB to Task+Note, or build create-verbs into ⌘K (its `SearchEntry[]` + `onPick` branching supports it). Not now.
- **Desktop app → stay web/PWA.** Native buys ~nothing over the installed PWA except a system-wide capture hotkey. If ever native, it's a thin **Tauri** capture companion only, never a port. (Reinforces: run HQ from the Dock as an installed PWA — that's what makes ⌘T/⌘N work.)
- **Files / Drive client-document management → APPROVED, build next session.** Full plan in 🔴 backlog item 0; approved mockup `hq-files-mockup.html` (this session).

### Jun 21 — Home cockpit (master-detail dive) + NoteEditor extraction

Home becomes the always-open workspace: from the deck you **dive** into a focused work view and
**surface** back, instead of being routed to the Notes/Tasks modules. Goal is to kill the
two-app pull (Todoist/Evernote) by making real note + task + KR work happen in place. Four files:
new `components/notes/NoteEditor.tsx`, `components/Notes.tsx`, `components/Home.tsx`, `app/hq/page.tsx`.

- **NoteEditor extracted to its own file** (`components/notes/NoteEditor.tsx`, exported). The TipTap
  editor — autosave (1.5s debounce + unmount flush), version snapshots, media upload + GC, internal
  `[[links]]`, tables, and the move/link-KR/history panels — moved verbatim out of `Notes.tsx` (with
  its sub-components `IconBtn`/`PanelRow`/`MovePanel`/`LinkKRPanel`/`HistoryPanel`/`Toolbar`/
  `TableToolbar` + `EMPTY_DOC`). Prop interface unchanged (`note, tags, spaces, roadmapItems,
  notebooks, fullscreen, onToggleFullscreen, onPatch, onSetTags, onOpenNoteByTitle, onDelete`), so it
  mounts identically in Notes' right pane AND the Home cockpit. `formatRelative` is duplicated (tiny
  pure helper; original stays in Notes for `NoteListItem`). `Notes.tsx` pruned of all now-unused
  editor imports.
- **Home dive stage.** Survey deck and a focused **work layer** are two `.layer`s inside a
  `.home-deck.stage`; `entered` toggles the `work-on` class for a 240ms cross-fade/scale (survey
  recedes, work view rises), with a `prefers-reduced-motion` fallback. `dive(target)` mounts the work
  layer (double-rAF in) + scrolls top; `surface()` animates out then unmounts; **Esc** surfaces (and
  closes the link picker first). Work layer has a `‹ Back to deck` button + breadcrumb.
- **KR work view = three columns** (`.cw-split`): **reference shelf** (every note linked to the KR,
  pinned-first then recent, date + preview; `+ New` makes a KR-linked note, **Link a note** opens a
  searchable picker that sets `roadmap_item_id`) · **NoteEditor** on the selected note · **tasks**
  (this-week actions for the KR + linked tasks + an add-action input). The editor's focus toggle
  drives **expand-to-spine**: shelf collapses to a 56px initials rail and the tasks column hides.
- **Note dive** = NoteEditor full-width. **Task dive** = detail (meta banner, description, linked-KR
  pill that dives to the KR, subtasks toggle, mark-complete).
- **Entry points on the deck:** clicking a key-action row or its `◆` KR pill dives into that KR; the
  right-rail Notes card was **repurposed to "Recent notes"** (top-4, space-filtered, preview) that
  dive into the note (replacing the old click-a-KR-to-load-notes rail + its `selectedKRId` state).
- **page.tsx** now passes `setNotes`, `notebooks`, `tagsByNote`, `setTagsByNote` to Home (it already
  held all four). `onOpenNote` stays in Home's Props (page still passes it) but is no longer
  destructured/used.
- Same `notes` table throughout — a KR note is a real Note (in the Notes module + search); the shelf
  is just the `roadmap_item_id == KR` view. No schema changes.
- **Calendar drag-and-drop (fix #4) — RESOLVED Jun 22.** Root cause was native HTML5 DnD itself
  (correct handlers, but unreliable on trackpad / inside the scroll container). Rebuilt on pointer
  events — see the Jun 22 entry. No longer open.

### Jun 21 (later) — Home polish pass

Tuning the default landing deck. One file (`components/Home.tsx`) + one helper (`lib/quotes.ts`).
**Supersedes the layout described in the Jun 21 Focus-retired entry below** (space-filter +
close-strip placement specifically).

- **Top leads with value content.** Order is now header → quote → Shape-of-the-week ribbon, then the
  controls. The **space-filter chips moved DOWN** to sit directly above the body board they narrow
  (key actions + rail), out of the top slot. The **weekly-close strip moved into the right rail under
  Notes**, restyled as a `.card` (`.closecard`) — it was a full-width strip near the top; now a
  compact rail card (`.card + .card` auto-spacing, chips wrap within the ~380px column).
- **Completed key-actions fall off the deck.** `actionGroups` filters `!a.completed` from the rendered
  rows; the "X of Y done" counter stays accurate (done/total computed from the full list before the
  filter); a space whose actions are **all** done drops its group entirely, and the empty state splits
  into "All key actions complete ✓" (total>0) vs "No key actions planned" (total===0).
- **Ribbon day-mode fixes.** All-day pills were hardcoded dark (`#1c2436`) → rendered as dark blocks in
  light mode. Now theme-aware: events `--accent-bg/--accent/--accent-line`, holidays `--warn-bg/--warn`.
  Self-created **`Busy (…)` / `Blocked (…)` holds are filtered** out of both meetings and all-day rows
  (`isHold = /^\s*(busy|blocked)\b/i`) so the ribbon shows real meetings only.
- **Quote randomizes per mount.** `lib/quotes.ts` gains `randomQuote()`; Home picks via
  `useState(() => randomQuote())` → fresh on every page open / refresh / nav-back (was day-of-year
  indexed). Quote block scaled **~15%** (`.q` 19→22, `.by` 12→13.5, `.mark` 30→35, padding/margin up).

### Jun 20–21 — Agent persistent memory + background watcher (Scout) · read_note [DOC CATCH-UP]

*Shipped across the Jun 20→21 agent sessions but missed by the Jun 21 Focus-retired sweep. Recorded
here from code-of-record.*

- **Persistent agent memory.** `agent_memory` table (`id, content, pinned, created_at`; owner_all RLS).
  `lib/db/agentMemory.ts` CRUD (listAll / create / updateContent / setPinned / remove). Injected into
  `buildAgentContext` as a "What you've learned about the operator (your memory)" block with `[mem:id]`
  tokens (📌 = pinned). Three **auto-applied, no-approval** tools (`MEMORY_TOOLS` / `MEMORY_TOOL_NAMES`,
  executed server-side in `/api/agent`): **`remember`**, **`update_memory`**, **`forget`** — they only
  shape the agent's own context, never mutate tasks/KRs/notes/calendar. Persona: one self-contained
  sentence per memory, don't duplicate, route to-dos/events/readings elsewhere. **Settings** screen has
  a memory panel (list / add / inline-edit / pin / delete).
- **`read_note` + server-side custom-tool execution loop.** `READ_TOOLS` / `READ_TOOL_NAMES`; `/api/agent`
  runs the tool mid-turn and feeds the `tool_result` back (call → run → append → call again → stream).
  Read-only, no approval. (This was Next-session candidate #1 — now shipped.)
- **Background watcher (Scout, autonomy rung 2).** `lib/watch.ts` `generateWatch({today, weekStart})` —
  a periodic check that surfaces something **only if genuinely new and worth interrupting** (else
  `surface:false`). Surfaced items write a **`source='watch'`** row into the SAME `briefings` feed
  (reuses the Stage-2 Approve/Dismiss proposal cards — no new UI), no archival note filed. De-dup:
  model self-dedupes against recent watch items + today's brief, plus a hard `dedupe_key` backstop
  (`wasRecentlySurfaced`, 18h lookback). `/api/cron/watch` (CRON_SECRET) on **two** daily Vercel crons
  (`30 19 * * *`, `0 0 * * *`). `briefings.source` + `dedupe_key` columns added via Supabase MCP.
  Rung 3 (autonomous *acting* on an allowlist) remains deferred.
- **Tasks row redesign.** Open rows render in 3 conditional modes (name / +description /
  +schedule&tags); completed pooled at the bottom under a "Done · N" eye-toggle (`completedFiltered` /
  `showDone`); add-task quick-add bar repositioned above the board (parser placeholder).

### Jun 21 — Focus retired · Reflect = weekly ritual hub · Home close strip

Focus was made fully redundant and **deleted**; its abilities were redistributed across Home,
Reflect, OKRs/ActionPanel, and the FAB. Six increments, each its own deploy; Focus deleted **last**,
only after every replacement was live. No schema changes this session.

- **Home — space filter restored + close strip + tag pill** (`components/Home.tsx`):
  - **Space filter chips** (All + per-space) re-added — narrow key actions, tasks-due, overdue, and
    habits (not the calendar ribbon, which isn't space-tagged). *(These had drifted out of the code
    after the Jun 20 Evolve refresh despite the doc below still claiming them — now genuinely present.)*
  - **Weekly-close status strip** below the filter — passive, all-spaces. Per space: muted ✓ when
    caught up, accent "close →" for the current week, amber "overdue →" when behind; click launches
    that space's Close Week. Renders only when ≥1 space is open. Same cursor-week rule as Reflect.
  - **Action-row tag pill** (backlog/waiting/doing) now shown on Home's key-action rows
    (`TAG_STYLE` mirrored from ActionPanel — read-only display; set in ActionPanel).
- **Reflect = per-space weekly ritual hub** (`components/Reflect.tsx`): owns both rituals + archive.
  - **Close Week launcher** — per-space rows: "Close week →" / "✓ up to date" (cursor advanced past
    the current week) / "✓ closed".
  - **Plan Week launcher** — a "Plan" button per space opens the existing `PlanWeek` modal for that
    space's cursor week. *(Pivot: Plan Week was briefly slated for Chief of Staff / agent-assist;
    Garry pivoted to "put it in Reflect like Close Week" — both human-driven, no agent.)*
  - **Archive** now shows **all spaces** (was active-space-only) with a space dot + name per card.
- **Close & Plan wizards decoupled from the active space.** `closingWizard` and `planningWizard`
  page state are each `{ spaceId, week } | null`; each wizard's data is re-derived for the target
  space at the render site (objectives/KRs/actions/habit+metric checkins/reviews filtered to
  `spaceId`; `setWeekStart` → `setWeekStartForSpace(spaceId, …)`). Any space closes/plans, not just
  the active one. `CloseWeekWizard` and `PlanWeek` components are unchanged.
- **Forced-launch auto-popup REMOVED.** The `useEffect` that auto-opened the close wizard for the
  active space's unclosed last week (and `forceCheckDoneRef`) is gone. The passive Home close strip
  replaces it — on the default landing, and covering **all** spaces, which the popup never did.
- **Focus deleted.** `components/Focus.tsx` + `components/FocusTasks.tsx` removed; NavRail Focus
  entry/icon/badge + `focusOpenCount` gone; `'focus'` dropped from both `Screen` unions; page's
  `openActionId` state removed. The ⌘K "open action" result (which jumped to Focus + ActionPanel)
  now routes to the action's KR in **OKRs** via the existing `krId` plumbing. App description
  (`manifest.json` + `layout.tsx`) no longer advertises "Weekly Focus".
- **Already-covered abilities (verified, no new code):** inline action-add lives in both the FAB
  (`FastCapture` Action dial) and `ObjectiveCard`'s "Add action"; tag editing lives in `ActionPanel`
  (canonical picker, used by OKRs/ObjectivePanel). FAB toast "…to Focus!" → "Action added!".

**Per-space close cadence (confirmed):** work spaces close **Friday**, personal spaces **Sun/Mon** —
independent `weekStartBySpace` cursors are real and used. Both launchers target each space's cursor
week; "caught up" = cursor advanced past the current Monday.

**Investigated, not a bug:** a Keeply close that looked like it "didn't roll forward / persist" had
in fact fully persisted (review + carried action created at the click timestamp — verified in
Supabase). The real issue was the launcher re-prompting a *future* week after the cursor advanced;
fixed with the "✓ up to date" caught-up state.


### Jun 20 (latest) — Evolve UI/UX refresh (whole-app) + Overview deleted

A full visual pass that **evolved** (not re-skinned) the night-watch/cobalt instrument-panel
identity onto a real type system, applied screen-by-screen worst-first, plus deletion of the
redundant Overview screen. Styling only — no migrations, no schema/logic changes.

- **Type system (foundation).** `app/layout.tsx` wires three Google fonts via `next/font/google`
  as variable fonts → CSS vars on `<html>`: **Space Grotesk** (`--font-display`, titles),
  **Inter** (`--font-body`), **JetBrains Mono** (`--font-mono`, readouts/data). Signature =
  **tabular-mono readouts under amber-mono instrument labels**, Space-Grotesk display titles.
- **`globals.css` rewrite.** Dark kept ~as-is; **light de-washed** (page bg → cool slate
  `#e7ebf2`, crisper borders, saturated status colors). All legacy token names (`--navy-*`,
  `--teal/red/amber/slate-bg/text`, `--nw-*`) **kept and re-pointed** so every component inherited
  the refresh unbroken. Added evolved vocabulary tokens (`--bg --surface --surface-2 --line
  --line-2 --line-strong --t-0..3 --label --ok/-warn/-alarm/-standby --card-shadow --radius-*`)
  + primitives (`.label .mono .chip .card`). **Do NOT redefine `--font-*` in `:root`** — collides
  with next/font.
- **Shell.** NavRail renders on **every** desktop screen now (removed the Home special-cases);
  hamburger only < 900px. Section labels → mono; active nav row gets an `--accent-bg` tint + a
  left accent bar.
- **Per-screen sweep** (header eyebrow + Space-Grotesk display title + mono labels/readouts):
  OKRs (+ a **segmented status bar** on ObjectiveCard replacing the progress bar), Home, Roadmap,
  Chief of Staff (`Agent` + `BriefingsFeed`), Reflect, Focus (+ `FocusTasks`), Tasks, Notes
  (note-title editor → display), Calendar, Parking, ⌘K `CommandPalette`, `FastCapture`,
  `ActionPanel`, `ObjectivePanel`. Tag/priority/status pills left as colored chips.
- **Overview/`Summary` screen DELETED** (was the long-standing Home-replaced-it backlog item).
  Removed the nav entry, the `screen==='overview'` route, the four `*FromSummary` handlers, the
  import, `OverviewIcon`, the `Screen`-type member (page + NavRail), and `components/Summary.tsx`
  itself. `Home` is the default landing so nothing routes to a dead screen. (Stray Summary/Overview
  mentions remain only in historical code comments — harmless.)
- **NOT swept (deliberate):** the modal shells — `Modal`, `EditKRModal`, `MetricLogModal`,
  `PlanWeek`, `CloseWeekWizard`, `History` — inherit tokens already; their own pass if wanted.

### Jun 20 (night) — Agent autonomy Stage 2 + full mutation tool surface

The Chief of Staff went from read-broadly/act-narrowly with a handful of tools to a broad
**propose-first** action surface, plus Stage 2 (actionable briefs) and spoken confirmation.

- **Stage 2 — actionable briefings + briefings-as-notes.** Each brief now writes a real note in an
  auto-created **"Briefings"** notebook (My OKRs space) and freezes its **proposals** (`{id,tool,input,
  status}`) on the `briefings` row. The feed renders Approve/Dismiss cards from those frozen proposals;
  "Open as note ↗" deep-links the note. Migration `briefings_add_note_id_and_proposals`
  (`note_id` FK + `proposals` jsonb, both nullable). `lib/briefing.ts` `generateBrief` now returns
  `{title, body, proposals}` (harvests tool_use). New `lib/notes/textToDoc.ts` (plain text → ProseMirror).
- **Conversation persists across navigation.** `messages`/`pending` lifted out of `Agent.tsx` into
  `page.tsx` (`agentMessages`/`agentPending`); the stream loop closes over parent setters so it keeps
  writing after the Agent unmounts on nav. `input` stays local; a pending guard blocks double-send.
- **Nav working signal.** Pulsing cobalt dot on the Chief of Staff NavRail row while the agent streams
  (`agentWorking` prop, desktop only).
- **Voice Step 2 — spoken yes/no confirms a proposal.** `useVoice` gained one-shot `say`. After the
  agent speaks a turn that carries a proposal, the next utterance is classified yes/no/unclear
  (`classifyConfirm`): yes → approve-all + "Done"; no → dismiss; unclear → normal turn. Tap-Approve
  still available. (Wake-word / VAD auto-listen deferred.)
- **Rich Markdown notes.** `lib/notes/markdownToDoc.ts` `markdownToTipTapDoc` (via `marked.lexer`) →
  ProseMirror JSON, emitting only schema-confirmed nodes incl. **tables** (pipe syntax), task
  checkboxes, code, blockquote, hr. `create_note` and the note editors author through it.
- **Full propose-first tool surface (all render an Approve card; client executor in
  `lib/agentActions.ts` `runProposedAction`):** `complete_task`, `reschedule_task`, `add_task`,
  **`update_task`** (title/due/priority/description + link-to-KR + move-to-space), `set_kr_health`,
  `create_calendar_event`, `create_note`, **`append_note`** (merges blocks, keeps content),
  **`update_note`** (rename/rewrite + link/move), **`log_metric`** (weekly upsert), **`log_habit`**
  (per-day, swallows duplicate), **`create_weekly_action`** (under a KR, current week),
  **`create_kr`** (under an objective so it can't orphan). + native `web_search`.
- **Context now exposes the ids the editors need.** `buildAgentContext` selects note `id` and emits
  `[note:…]` (recent-notes limit 8→15); fetches active `annual_objectives` and emits `[obj:…]` under
  each space header. So `append_note`/`update_note`/`update_task` can target real rows and `create_kr`
  has an objective to attach to.
- **Verified live (Chrome + Supabase):** `create_kr` lands attached to the named objective;
  `append_note` grows the body (4→5 blocks) — both Approve→DB writes confirmed, test rows cleaned up.
  The other five tools share identical plumbing. No new migrations this batch beyond the briefings one.

### Jun 20 (evening) — Voice LIVE · Proactive briefings (web push) · Settings screen

**Voice is live end-to-end.** Deepgram nova-3 STT + ElevenLabs flash_v2_5 TTS keys are in Vercel
Production. ElevenLabs is on the **Starter ($6/mo)** plan — the free tier 402'd on the default Rachel
"library" voice; paid unblocked it. Round-trip verified live (TTS a phrase → feed mp3 to STT →
verbatim transcript) and the in-app talk→hear loop works. Routes auth-gate (401) before key-check
(503); the Bearer is the Supabase session JWT. (Mic gotcha: macOS Continuity can grab the iPhone as
input + Chrome notifications/mic must be enabled at the OS level.)

**Proactive briefings (web push) — Stage 1 shipped.** A scheduled, read-only morning brief grounded
in live HQ state. The autonomy ladder: **Stage 1 = read-only briefings (DONE)** → Stage 2 actionable
proposals → Stage 3 autonomous acting.
- `lib/briefing.ts` `generateBrief({today, weekStart})` reuses `buildAgentContext` headless
  (service-role, no token) + a non-stream `claude-sonnet-4-6` call → `{title, body}` JSON. `saveBrief`
  persists each brief to the `briefings` table.
- Push plumbing: `public/sw.js` (push + notificationclick → focuses/navigates an open HQ tab to the
  brief, else opens it), `lib/push.ts` (web-push VAPID sender), `lib/db/pushSubscriptions.ts` (admin
  store/list/delete/markSent, upsert on endpoint).
- `app/api/push/subscribe` (save/remove a sub) · `app/api/push/test` (user-authed on-demand trigger —
  generates, persists, pushes) · `app/api/cron/brief` (CRON_SECRET-authed; `vercel.json` cron
  `0 14 * * *` = 7am PDT; pushes to all subs as the known owner).
- **In-app feed:** `components/BriefingsFeed.tsx` renders the latest brief + an "N earlier" expander
  in the Chief of Staff screen; reloads on a `hq:brief-saved` window event. Notifications deep-link to
  `/hq?screen=agent` (handled in `page.tsx`'s query-param effect).

**Settings screen + persistent push (the friction fix).** Enabling briefings was resetting every
Chrome restart because the subscription wasn't re-established on load. Fix: `lib/push/ensurePush.ts`
(`ensurePushSubscription` — idempotent re-register+subscribe+sync, `enablePush`, `disablePush`,
`currentPushState`) is called **on every app load** in `page.tsx` (effect above the auth early-returns)
when permission is already granted — so "Turn on" is a genuine one-time action per device. New
**Settings** screen (`components/Settings.tsx`, NavRail Meta group, gear icon, `screen==='settings'`)
owns the briefings toggle + status + Send-test. The old enable button was removed from the Chief of
Staff header (`BriefingsFeed` stays there). `components/PushSetup.tsx` is now **orphaned dead code**
(nothing imports it) — delete when convenient.

Migrations (Supabase MCP, not repo files): `create_push_subscriptions`, `create_briefings`.
New deps: `web-push`, `@types/web-push`. New env: VAPID_* / CRON_SECRET (see Stack & infra).

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
**Status: LIVE** as of Jun 20 evening — keys in place, ElevenLabs on Starter plan, round-trip
verified. See the Jun 20 (evening) section above. Routes still return a graceful 503 if a key is
ever missing.


### Jun 20 (late) — Tasks: Backlog smart view

`components/Tasks.tsx`: new `'backlog'` SmartView = **undated open tasks** (`!due_date`,
non-subtask, not completed) across all spaces + lists. Sidebar row (stacked-bars
`BacklogIcon`) between Recurring and All open, with live count. Pure filter, no schema
change. This is the triage destination the planned **Home deck**'s "Backlog" action targets.
(Undated tasks bucket under "Later" in the list view — minor wart, acceptable.)

### Jun 20 — Unified "Home" weekly command deck (SHIPPED, default landing)

Focus's all-spaces concept shipped as a dedicated **Home** screen (`components/Home.tsx`), now the
**default landing** (top of NavRail, `screen==='home'`). Built over 7 mockup iterations
(`hq-home-week-deck-mockup-v7.html`). **The Overview/`Summary` screen has since been DELETED**
(Jun 20 latest — see top of Current state). Shape:

- **Color = space** everywhere (5 space dots; legibility pass on space colors still TODO —
  Keeply `#0B1E3F` is invisible on dark, needs a display variant).
- **Daily quote** under the header — curated public-domain pool (stoics · sailors · Franklin),
  rotated by day-of-year, no external API. (`lib/quotes.ts`.)
- **Space filter chips** (All + per-space) filter the whole board. *(Dropped in the Jun 20 Evolve refresh; restored Jun 21 — see top of Current state.)*
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

**Build sequence — all shipped:**
1. ✅ Backlog smart view in Tasks.
2. ✅ `notes.roadmap_item_id` nullable (mirrors `tasks.roadmap_item_id`).
3. ✅ Notes↔KR link picker + `lib/db/notes` helper.
4. ✅ All-day Google events surfaced for the ribbon. *(superseded earlier follow-up — verify still holds)*
5. ✅ `lib/quotes.ts` daily-quote module.
6. ✅ Home deck — new all-spaces screen, default landing + top NavRail entry.
7. ✅ **Delete the Overview/`Summary` screen** — done Jun 20 (latest).
8. ✅ Inline handlers: complete / Backlog / Snooze→tomorrow / Kill + FAB quick-add.

Decisions locked: notes = click-to-open (not inline edit); Backlog lives in Tasks; Kill =
hard delete (no confirm); attention = overdue tasks only; quote pool = public-domain
sailors/stoics/Franklin.

### This session (Jun 19/20) — Calendar + Google Calendar integration

**Calendar module** — a first-class all-spaces time-blocking view (own NavRail entry).
- **Template mode:** drag-to-create a standing weekly capacity template. Each window is
  space-scoped (or "Any") and kind-scoped (`kr_action` | `task` | `both`).
- **Week mode:** Mon–Sun time grid (6 AM–10 PM). **Pointer-based** drag-and-drop (rebuilt off native
  HTML5 DnD Jun 22) to place unscheduled items (KR actions + due tasks, each with a duration) into
  matching capacity windows: a cursor ghost + live valid-window highlight + dashed snap-preview, Esc to
  cancel; drop validation mirrors the planner's `accepts()` (kind + space must match; clamps to the
  window; invalid drops rejected with a toast). Drag a placed block to reschedule. The unscheduled rail
  groups by space — each group header is a persisted click-to-collapse toggle (`hq-cal-collapsed-spaces`);
  item titles wrap to two lines with a full-name hover tooltip.
- **Greedy planner** (`lib/calendarPlan.ts`, pure) — "Quick fill" first-fits items into
  matching windows, off-track KRs first, then priority, then due date; schedules **around**
  commitments (committed HQ blocks + Google meetings) **and the past** (never places earlier than now —
  prior days fully blocked, today up to the current minute, via the optional `now` cutoff). Blocks are
  `proposed` (dashed) until committed.

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

- **Evernote `--repair` re-import** — run `node evernote-migrate.mjs ~/Desktop/ --repair` once to restore the 194 table-containing notes with proper TipTap table JSON. Script is on Desktop. The 194 placeholder notes were already deleted from DB this session; only the re-import remains.
- **Issue 2 Phase B — weekly-update ritual (deferred).** Phase A gave actions an inline update thread; Phase B makes "weekly update" first-class: a `＋ this week's update` prompt stamped to the current week (per objective/KR), logs **grouped/badged by week**, and a tie-in to **Close Week** so the weekly reflection is part of the ritual. Build when Garry's tested Phase A.
- **Action update thread only on the Focus band.** The `▸ note` thread lives on `.focusw` rows but not yet on the per-objective `.act-col` rows (`colActionRow`). Mirror it there if the dual surface is wanted — same `logsByAction`/`submitActLog`.
- **Objective logs are ⋯-drawer only.** Objectives write/read logs through `ObjectivePanel`; KRs + actions have inline threads on Home. Promote objective logs inline on the card if more prominence is wanted (the card is dense — likely a full-width "Updates" strip under the expanded columns).
- **Space deep-links land on Home unfiltered.** ⌘K "go to a space" now routes to Home but doesn't set
  Home's sticky `hq-home-space-filter`, so Home opens on whatever filter was last persisted. Push the
  space into Home's filter from the route if the mismatch bugs Garry. ~15min.
- **`ObjectivePanel` (links/logs) is desktop-drawer only** — opens as a fixed ~520px right drawer from
  Home; no mobile treatment. Folded into the responsive `ActionPanel`/`ObjectivePanel` backlog item.
- **Per-space week vs Home week divergence (root of the orphan bug) only partially closed.** Phase 1 fixed
  the *symptom* — new KR actions default to backlog (`week_start: null`), and the OKR card's "this week"
  now uses real `getMonday()` instead of the stale per-space `weekStart`/`legacyWeekStart` fallback. But the
  underlying split (OKR tab runs on `weekStartBySpace[activeSpaceId] ?? legacyWeekStart ?? getMonday()`,
  Home deck on its own `getMonday()`-seeded state) still exists. Full week-model unification is its own job.
- **Daily metric logging** (parked, unchanged) — generalize `metric_checkins` from weekly to dated entries:
  rename `week_start` → `entry_date` (~4–8 reader files), log modal defaults to today, Close Week reads the
  latest reading in the week. `week_start` is a plain `date`; weekly-ness is app convention (`MetricLogModal`
  stamps `getMonday()`), not a schema limit. One migration + ~4 files. Sparkline/flip already plot whatever
  points exist, so daily "just works."
- **Image node-level storage GC** (Notes) — deleting an image mid-edit doesn't GC that one file until the
  note is deleted; needs body-diffing on save.
- **Push: dedupe subscriptions.** Same machine can leave multiple `push_subscriptions` rows over time;
  `ensurePushSubscription` upserts on endpoint so it self-heals for one browser, but a server-side
  dedupe/cleanup pass would be tidier. Stale endpoints already get pruned on send ('gone' → delete).
- **iOS web push** needs the PWA added to the Home Screen first (Safari limitation) — desktop Chrome
  works as-is.
- **7am cron not yet verified unattended** — `/api/cron/brief` works on-demand; first natural 14:00 UTC
  fire hasn't been observed. Confirm a brief lands + persists without manual trigger.
- **Orphaned `components/PushSetup.tsx`** — superseded by Settings + `ensurePush`; nothing imports it.
  Delete when convenient.
- **Rotate voice keys** — `DEEPGRAM_API_KEY` + `ELEVENLABS_API_KEY` transited a chat session during
  setup. Rotate in the provider dashboards + update Vercel when convenient. (Low priority.)
- **Migrations applied via Supabase MCP aren't repo files.** This session's `objective_logs_add_weekly_action_id`;
  prior `add_failed_health_status`, `objective_logs.roadmap_item_id`, `add_objective_start_end_dates`
  (and earlier `create_tracked_files`,
  `create_file_versions`, `weekly_actions_week_start_nullable`, `create_push_subscriptions`,
  `create_briefings`, `relax_calendar_block_source_for_freeform_events`) live in
  Supabase's migration history, not as tracked files. Fine operationally; capture as files only if
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
- **Calendar drag has no auto-scroll** near grid edges (pointer-based; window listeners track the
  cursor but the scroll container isn't nudged when you drag to its top/bottom edge).
- **Audit #4** — extract `useSpaceData(activeSpaceId)` hook (drops ~100 lines from
  `page.tsx`). **Audit #5** — design-token module `lib/tokens.ts` (incremental).

---

## Backlog / roadmap

### 🔴 Next-session candidates
0. **Tauri desktop app — SHIPPED (Jun 27).** Native file/folder picker working on objective resource links; shellOpen opens files/folders in Finder/default app; ⌘T/⌘N global shortcuts; tray icon. Architecture: shell at `tauri://localhost` (dist/index.html) wraps `hq.svirene.com` in a fullscreen iframe; postMessage IPC between iframe and shell; shell calls Rust invoke(). Repo: `garry-cmd/operation-hq-desktop`. Key lessons: WKWebView blocks fetch() and invoke() from remote HTTPS URLs — only `tauri://localhost` is a trusted origin. Detection via `HQ_TAURI_READY` postMessage on iframe load (not a ping). normalizeUrl must pass local paths (starting with /) through unchanged.
1. **Files / Drive — SHIPPED** (see top entry). Residual follow-ups:
   - **Native "double-click → open in Excel/Acrobat"** — what Garry actually wants for files; the browser
     can't launch local apps. Needs a thin **Tauri** capture/companion shell exposing `openLocalFile(path)`
     (capture Drive files' local synced paths; degrade to "Open in Drive" in plain browser). Same shell would
     unlock the system-wide ⌘T/⌘N capture hotkey (see keyboard layer). Interim: Drive-for-Desktop "open Office
     files in their default app" setting (zero code).
   - **"Link an already-tracked file to this KR"** picker on Home (attach-existing, symmetric with the note
     shelf's "Link a note") — deferred from the files-on-KR build; today only +Track (new) links.
   - **Auto-watch Inbox** (the folder-watch the original plan wanted) is NOT built — drive.file can't enumerate
     a folder. Escape hatch if ever wanted: service-account + shared-folder watch. drive.file + Picker is the
     shipped model; revisit only if manual Picker tracking proves too heavy.
1. **Home — closed-space suppression** — the objective spine auto-expands an objective whenever any KR has a
   this-week or backlog action, regardless of the space's status, so a closed space's objective can still
   surface as "active". Harmless; drop closed spaces from the active set if it bugs Garry. ~15min.
2. **Re-plan button decision** — currently opens legacy `PlanWeek` modal. Likely just delete it +
   `PlanWeek` (~10min). Confirm Re-plan is unused first.
3. **Subtasks UI polish** — `parent_task_id` shipped on Tasks; confirm parity on Calendar surfaces.
4. **Agent — postponed mutation tools (conscious opt-in).** Destructive `delete_task`/`delete_note`/
   `delete_kr`; calendar event **edit/delete** (two systems: `calendar_blocks` row + Google event);
   note pin/move-to-notebook + task move-to-list (need notebook/list ids exposed in context);
   **autonomy rung 3** (autonomous low-risk acting on an allowlist — the watcher already surfaces at
   rung 2). Deferred deliberately, not dropped.

### 🟡 Feature backlog
5. `useSpaceData` hook (audit #4). ~1hr.
6. "Plan your first week" for empty spaces (see Parked).
7. Quarter-close summary when the rolling 4Q window advances. ~3–4hr.
8. Recurring-action visual badge on Home action rows (Focus retired). ~30min.
9. Drag to reorder objectives (`sort_order` exists). ~2hr.
10. Drag to reorder tasks (`sort_order` exists). ~2hr.
11. Extract shared `TAG_STYLE`/tag picker (dup'd in `Home`, `ActionPanel`, `Tasks`). ~30min.
12. Propagate done-KR treatment (strikethrough + 0.45 opacity) beyond Roadmap. ~1hr.
13. Metric-card pace-aware status (compare progress to quarter time-elapsed). ~1–2hr.
14. Responsive `ActionPanel` / `ObjectivePanel` (still desktop-only at 800px). ~2hr.
15. **Calendar:** per-user timezone (kills the `APP_TZ` hardcode); all-day event handling in overlay; recurring HQ blocks; DnD edge auto-scroll.

### 🟢 Nice to have
Share-page query optimization · PWA install prompt · more keyboard shortcuts (⌘Enter save, Esc close — note ⌘T/⌘N/`g`-nav already shipped) · Reflect history sparkline.

### ❄️ Deferred indefinitely
- **Multi-user SaaS-ification** (Mel + shared spaces) — needs real RLS, `spaces.owner_user_id`
  + `space_members`, every policy rewritten, invite/signup, role-aware UI. 8–20hr, planning doc first.
- **RLS hardening pass** — `spaces` RLS disabled; others `owner_all USING (true)`. Fine solo, exposed multi-user.

### Parked / open decisions
- **Todoist + Evernote as external surfaces (Jun 26 decision).** Native Tasks and Notes stay in HQ but are no longer the primary surface for daily work. Todoist handles task capture/reminders/mobile; Evernote handles notes/web clipping/OCR. HQ links to them from objective cards. Native Tasks module kept for KR-linked work that needs alignment scoring.
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
13. **Persistent web push = re-ensure on load, don't re-prompt.** When permission is already granted,
    silently re-register the SW + re-subscribe + sync to server on every app load (idempotent, upsert
    on endpoint). The "enable" button is then a true one-time opt-in per device, not a per-session chore.
14. **Build-time env + paid-tier gotchas.** `NEXT_PUBLIC_*` inline at build → set before building, and
    force a clean rebuild (`git commit --allow-empty`) when a running deployment can't see a changed
    value. ElevenLabs "library" voices (e.g. Rachel) 402 on the free tier — needs a paid plan.
15. **Type system = Space Grotesk (display) / Inter (body) / JetBrains Mono (data), via `next/font`.**
    Wired in `layout.tsx` as `--font-display/-body/-mono` on `<html>`. Screen pattern: **mono amber
    eyebrow ("Group · Screen") → Space-Grotesk display title → mono labels + tabular-mono readouts**.
    Cobalt accent + colored status pills unchanged. Evolve via these vars + the re-pointed legacy
    tokens; never redefine `--font-*` in `:root` (collides with next/font).
16. **Sandbox build can't fetch Google Fonts (egress blocked), so `npm run build` fails at the
    `next/font` step.** To verify a styling change compiles: `npx tsc --noEmit` (grep out
    `validator.ts`), then temporarily swap `layout.tsx` for a no-`next/font` stub and run the full
    build — it compiles every route; the only remaining error is the env-less `/hq` prerender
    (`supabaseUrl is required`), which is the known cosmetic false-positive. Restore the real
    `layout.tsx` (grep-confirm `next/font/google` present) before staging. Garry's Mac has open
    network → his build fetches the fonts and succeeds.

17. **`minmax(0,1fr)` for grid tracks holding wide content.** A plain `1fr` track has implicit
    `min-width:auto` and expands past its share to fit its widest child (long KR/objective text) →
    horizontal overflow that shoves sibling tracks off-screen. Use `minmax(0,1fr)` so the track can shrink.
18. **Sticky view-state via localStorage** (`hq-home-*` keys, SSR-safe `loadLS<T>(key, fallback)`) — mirror
    the `tasks-show-done` pattern: read on init, persist in one `useEffect` per key. Home remembers its space
    filter, quarter scope, and per-objective collapse across reloads.
19. **Objective-spine + page-level panels.** On Home an objective auto-expands when ≥1 KR has a this-week or
    backlog action ("active"); the rest collapse. `ObjectivePanel` (links/logs) is a **page-level** drawer
    (`openObjectiveId` lifted to `page.tsx`), owned by no single screen, so deep-links open it over Home.
    Editing modals (`EditKRModal`/`EditObjectiveModal`) are shared components rendered in place by whatever
    surface needs them — extract from a screen before a second caller needs it, not after.

Earlier (May 14): desktop-first; SECURITY DEFINER RPCs for anon validation; NULL as "applies
broadly" sentinel; paired text+structured forms; rolling state over event logs for recurrence;
no-dep date math.

---

## Deploy workflow (autonomous — Jun 27+)

Claude pushes directly to GitHub; Vercel auto-deploys on push to `main`; Claude polls `Vercel:list_deployments` until `READY`. Garry's role: verify features work.

**Session start:** paste the GitHub PAT (session-scoped, not persisted):
```
PAT: github_pat_XXXX...
```

**Claude's deploy loop:**
1. Clone/sync repo fresh: `git clone --depth 1 https://garry-cmd:<PAT>@github.com/garry-cmd/operation-hq /tmp/operation-hq`
2. Make changes in sandbox (`str_replace`, `bash_tool`, etc.)
3. Verify: `npx tsc --noEmit 2>&1 | grep -v "validator.ts\|next/server\|Cannot find module\|@types/node"`
4. Commit + push: `git add -A && git commit -m "..." && git push origin HEAD:main`
5. Poll `Vercel:list_deployments` (projectId `prj_rgWkigVjdCzawkB3g00GqTIMFTEC`, teamId `team_FD2H6R0bDq59mIOZWsPE8YLg`) until `READY`; if `ERROR`, pull build logs and fix immediately
6. Garry verifies the feature in the live app

**Desktop repo:** `garry-cmd/operation-hq-desktop` — Rust/Tauri changes require `cargo tauri build` on Garry's Mac after `git pull`. Claude pushes source; Garry rebuilds the binary.

**Sandbox build note:** `npm run build` fails in sandbox (egress blocks `fonts.gstatic.com`). Use `npx tsc --noEmit` to catch type errors. The env-less `/hq` prerender error (`supabaseUrl is required`) is a known false positive — ignore it.

**Staging-first rule:** push to a staging branch for schema migrations, payment flows, auth flows, or irreversible data writes. Everything else goes straight to `main`.

**Re-sync within session:** `git fetch --depth 1 origin main && git reset --hard origin/main` before re-patching files already touched this session — main moves fast.

*Legacy workflow (no PAT):* Claude stages files to `/mnt/user-data/outputs/`, presents with `present_files`, gives a single fenced bash block with explicit `cp` commands. Used only when PAT not available.

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
| Irene | `92e0a6df-631e-4bf3-a26a-66d924e21754` |

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
  │     │     .health_status: not_started|backlog|on_track|off_track|blocked|done|failed
  │     │     ├── weekly_actions (roadmap_item_id)  .estimated_minutes  .week_start NULLABLE (NULL = unscheduled backlog)
  │     │     ├── habit_checkins / metric_checkins (UNIQUE roadmap_item_id, week_start) / daily_checkins
  │     ├── objective_links (objective_id)
  │     └── objective_logs (objective_id) — unified log/update substrate.
  │             .roadmap_item_id (NULL ok → KR-scoped) · .weekly_action_id (NULL ok → action-scoped, ON DELETE CASCADE) · .title · .content · .log_date
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
push_subscriptions — id, user_id, endpoint (UNIQUE), p256dh, auth, user_agent, created_at,
  last_sent_at.  RLS owner_all. Web-push subscriptions (one row per browser/endpoint).
briefings — id, user_id, title, body, for_date (date), source 'manual'|'cron', created_at.
  RLS owner_all. Persisted Chief-of-Staff morning briefs (read in BriefingsFeed).
tracked_files — id, space_id NULLABLE (NULL=Inbox), drive_file_id (UNIQUE), name, mime_type,
  drive_modified_time, status 'new_in'|'editing'|'with_client'|'sent', archived, sort_order,
  roadmap_item_id/note_id/task_id NULLABLE FKs (ON DELETE SET NULL).  RLS owner_all. Drive-backed
  client-doc tracking (drive.file scope + Google Picker).
file_versions — id, tracked_file_id (FK CASCADE), direction 'received'|'sent', drive_file_id NULLABLE,
  snapshot_name, source, dest, note, created_at.  RLS owner_all. Per-file version ladder.

(root) task_tags (task_id, tag) · note_tags (note_id, tag) — global tag namespaces
```

**RPC:** `find_active_share_token(p_token text) RETURNS json` — SECURITY DEFINER, anon-callable.

---

## Theme

**Type (Jun 20):** three fonts via `next/font/google` in `layout.tsx`, exposed as CSS vars on
`<html>` — `--font-display` (**Space Grotesk**, titles), `--font-body` (**Inter**, default),
`--font-mono` (**JetBrains Mono**, all readouts/labels/data, `font-variant-numeric: tabular-nums`).
Screen signature: mono amber eyebrow → display title → mono instrument labels + tabular readouts.

**Color:** night-watch palette, dark/light. Legacy semantic tokens
(`--teal/red/amber/slate-bg/text`) and `--navy-*` are **re-pointed** in `globals.css` so components
inherit the look without per-component edits. Light mode is **de-washed** (page bg cool slate
`#e7ebf2`, crisper `--line*` borders). Evolved vocabulary tokens live alongside the legacy names:
`--bg --surface --surface-2 --hover --line --line-2 --line-strong --t-0..3 --label --label-dim
--ok/-bg --warn/-bg --alarm/-bg --standby/-bg --accent/-2/-bg/-line --card-shadow --radius-sm/-/-lg/-xl`,
plus primitives `.label .mono .chip(.chip-ok/warn/alarm/standby) .card`. Identity tokens still used
directly: `--nw-label` (amber labels), `--nw-cream`, `--nw-hero-amber`,
`--nw-alarm/caution/nominal/standby-text`. Cobalt `--accent` for all interactive elements.
Per-space object colors: `#0ea5b8 #14b87f #c8a040 #d4885a #c44a7c #8b5cf6 #6b8caa #5b8def`.
