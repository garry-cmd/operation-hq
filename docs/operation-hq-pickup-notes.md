# Operation HQ — Session Pickup Notes

> ⚠️ **Superseded by [`/CONTEXT.md`](../CONTEXT.md)** (root) as of Jun 19, 2026 — that is now
> the single source of truth for current state, backlog/roadmap, conventions, deploy workflow,
> spaces/IDs, and schema. This file is **retained for history** (session-by-session detail)
> and is no longer maintained.

*Last updated: Jun 19, 2026 (end of day) · The May 18 starter below is retained for history; read the Jun 19 block first.*

---

## 🧭 Current state (Jun 19, 2026) — read this first

Four sessions shipped Jun 19 (full detail in `operation-hq-session-2026-06-19.md`):

**Session 1 — objective/KR time windows + metric cards.** Objective start/end dates
(migration `add_objective_start_end_dates`), surfaced on OKR cards + Roadmap headers
(alarm-red when overdue); "N wk remain" retargeted to the objective's own end_date; KR
date windows on Roadmap chips; Roadmap KR editing unified onto the shared `EditKRModal`
(optional `quarters` selector + `onPark`); metric KPI sparklines; metric **flip cards**
(front sparkline / back readings, "+ Log" on the back).

**Session 2 — Notes to near-Evernote parity.** Inline images + file attachments (private
`note-media` bucket, body stores storage **path** not URL), dividers, robust tables
(resize + per-cell colors + checkboxes in cells), focus mode, pinned notes, internal
`[[ ]]` links, quick-file Move, Markdown export, version history (`note_versions`),
storage GC, sub-notebook depth→3. **Strategic call: Evernote → REPLACE; Todoist → WRAP.**

**Session 3 — Command Palette search rewrite + KR deep-linking.** The old sidebar search
dropdown is gone; ⌘K opens a **centered command palette** with a flat ranked, multi-source
index (objectives, KRs incl. parked, all actions, tasks, notes + bodies, reflect,
notebooks, spaces, tags). Multi-term AND (word-order independent), accent highlighting,
keyboard nav. **Scoping operators** `#tag` / `in:<space>` / `task:`/`note:`/`kr:`/`obj:`/
`action:`/`reflect:`/`notebook:`/`space:` (scope-only queries list everything in scope).
**Fuzzy typo tolerance** (bounded Levenshtein, ranked below substring). **Recent items** on
empty query (`localStorage['hq-search-recents']`). Every pick **deep-links to the item** —
switches space, opens the panel, jumps to the week; KRs **scroll-to + flash** the row/chip
(auto-expanding the owning ObjectiveCard first). Plus a version-aware Notes media-GC fix.

**Key new modules:** `lib/search.ts` (ranker), `components/CommandPalette.tsx`,
`lib/scrollFlash.ts`, `lib/notes/collectMediaPaths.ts`. No schema changes in Session 3.

**Session 4 — Kill Todoist: native task surface to parity + Todoist→HQ migration.**
Strategic reversal: **Todoist WRAP → REPLACE.** Built native Tasks to operational parity —
durations (`estimated_minutes`) + deadlines (`deadline_date`) + subtasks + KR-link picker
(D1); **sections in lists** + date-anchored recurrence (`RecurrenceRule.bymonth`) + both-null
Inbox (D2); **sections in spaces too** (`task_sections.space_id`, XOR parent; spaces stay in
the due-bucket view until ≥1 section, then opt into section grouping). Then **migrated 87
non-OKR / non-boat Todoist tasks** into HQ across 2 new lists (Admin & Compliance, Reading)
+ 3 spaces (USPSA, VidScrip, Keeply) and ~10 new sections — recurrence translated through
the app's own `parseRecurrence` (0 unparsed). Deduped 5 stale pre-existing predecessors;
bills consolidated under Admin & Compliance. Migrations: `tasks_add_estimated_minutes_and_
deadline_date`, `task_sections_and_inbox_container_relax`, `task_sections_allow_space_parent`.

**Still parked:** **D3 / Todoist retirement** — Todoist originals are still in Todoist
(delete only after HQ is confirmed, else the Focus strip double-counts); then remove
`TodoistStrip.tsx` + `/api/todoist/*` + env var; reminders/push (PWA), mobile capture,
email→task. Notes whole-app visual redesign (`hq-notes-redesign.html`, awaiting an aesthetic
decision); daily metric logging (`week_start`→`entry_date` refactor); OCR; web clipper.

---

## 🎯 Session starter — read this first (May 18 — retained for history)

**Heavy chrome + plumbing session.** Eleven distinct shipments today across bug fixes, mobile fallback, Tasks/Notes refinement, and a full UI palette propagation. The app's visual identity is now unified end-to-end under the "night-watch" palette; both light and dark mode read as one family.

**What to do first when picking up:**

1. **Verify the night-watch propagation still holds.** Walk through every tab (OKRs, Focus, Tasks, Notes, Roadmap, Reflect) in both light and dark modes. Confirm:
   - Section labels are amber uppercase (`var(--nw-label)`, .16em letter-spacing) everywhere they appear
   - Status chips (ON TRACK / OFF TRACK / BLOCKED) use phosphor green / alarm red / caution amber, not the old peach/coral
   - Cobalt `--accent` is preserved on interactive elements (buttons, links, active nav, brand wordmark, "+ New" CTAs)
   - Object-color identity colors on Roadmap (per-space tints) are still distinct — they're not part of the status palette

2. **Eyes-on the unified Notes Inbox.** Click into Notes:
   - Default scope on entry should be Inbox (📥) — empty until you put a note in it
   - SMART VIEWS section at top (Inbox + All notes) with amber section header
   - SPACES section below — clicking a space row shows all notes in that space; chevron toggles notebook expansion
   - Hit + on Inbox scope → creates a note with `space_id=null, notebook_id=null`
   - Old notes still appear under their respective spaces (they kept their `space_id`)
   - From a tag or All notes, hitting + drops the new note in unified Inbox (location-ambiguous fallback)

3. **Eyes-on Tasks lifted state.**
   - NavRail badge on Tasks should show today+overdue count (no longer stuck at 0)
   - Cmd+K search across the app should match task titles; selecting one routes to Tasks with that row pre-selected
   - Open tasks first, then done, capped at 8

4. **Eyes-on mobile fallback** (< 900px viewport):
   - Hamburger top bar appears, NavRail becomes slide-in drawer with backdrop
   - Tasks sub-sidebar collapses to a dropdown opener; detail panel becomes fullscreen overlay
   - Notes: notebook tree + note list become independent dropdown openers; editor fills remaining viewport
   - Focus habits grid scrolls horizontally instead of clipping Sat/Sun

5. **Then decide direction:**
   - **Re-plan button** — discussed but deferred. Current button opens legacy PlanWeek modal. Open question whether to (a) point at wizard step 2 with a replan mode, (b) remove the button entirely (you already have Close Week), or (c) drop PlanWeek and point Re-plan at wizard with closingWeek=current. **Pickup question: do you actually use Re-plan? If not, just remove it.**
   - **KR linker UI on tasks** — column exists (`roadmap_item_id`), no UI yet. Wires Tasks → OKRs.
   - **Subtasks UI** — schema exists (`parent_task_id`), no UI.
   - **Phase 3: Notes Tier 2** — pinned notes, internal `[[ ]]` links, deeper nesting.

---

## TL;DR

Eleven shipments. Roughly three buckets:

**Bug fixes & per-space hygiene:**
1. CloseWeekWizard health/progress pills wrap as groups (not mid-row)
2. Focus week is now per-space — closing in one space no longer advances the others
3. CloseWeekWizard hides done KRs from review surfaces (kept in `activeKRs` so stats stay accurate)
4. KR reorder arrows on each row

**Polish (visual chrome):**
5. OKR ObjectiveCard polish v1 — Keeply-style hero typography, 3px object-color left-border
6. OKR ObjectiveCard night-watch palette — amber instrument labels, phosphor green progress, alarm-red status chips
7. OKR summary cards (habit + metric KPIs at top of tab) restyled to match ObjectiveCard chrome
8. **Full night-watch propagation app-wide** — re-pointed `--red-text` / `--teal-text` / `--slate-*` etc. in globals.css, plus amber-uppercase section labels across NavRail / Focus / Tasks / Notes / Reflect / CloseWeekWizard

**Feature work:**
9. Mobile drawer NavRail + responsive Tasks/Notes/Focus (<900px breakpoint)
10. Tasks: Done section collapse toggle (persisted), Recurring smart view
11. **Lifted Tasks state to page.tsx** — NavRail badge live + Tasks in global search
12. **Unified Notes Inbox** — single Inbox smart view (notes with no space, no notebook), Spaces section mirroring Tasks layout, `notes.space_id` made nullable

---

## What changed this session (May 18)

### Bug fixes (morning agenda)
- `components/CloseWeekWizard.tsx`: wrapped health pills and progress controls in separate inline-flex containers so they wrap as units; added `whiteSpace: nowrap` on health labels.
- `app/hq/page.tsx`: `weekStart` lifted to `Record<spaceId, string>` (`weekStartBySpace`) persisted as `hq-week-start-by-space` JSON, with legacy `hq-week-start` read once as fallback. Added `setWeekStartForSpace(spaceId, updater)` for cross-space jumps where `activeSpaceId` closure hasn't propagated. Search filter for "Action this week" uses each action's own space's weekStart via `roadmap_item_id → space_id` lookup.
- `components/CloseWeekWizard.tsx`: `habitKRs`/`metricKRs`/`outcomeKRs` filter `.health_status !== 'done'` at source. `activeKRs` stays unfiltered so `krs_hit` stats are accurate.
- `components/ObjectiveCard.tsx`: added `moveKR(kr, direction)` swapping `sort_order` with adjacent sibling via `Promise.all` of `krsDb.update`. Small ▲▼ buttons between status pill and edit pencil, disabled at boundaries. KRs sorted locally by `sort_order` for optimistic visual reorder.

### OKR ObjectiveCard polish
- `components/ObjectiveCard.tsx`, `components/OKRs.tsx`: 3px object-color left-border replaces lavender card tint. "Q2 OBJECTIVE" crumb, hero 0% at 56px/700, ghost `/ 100%`, weeks-remaining + KRs-hit stack. Progress strip with Start/N weeks remaining/Q-close. Aggregate off-track/blocked chips conditional. KR row status pills restyled small/uppercase/dotted.

### Night-watch palette (OKR tab → app-wide)
First applied to ObjectiveCard, then summary cards, then propagated to globals.css and app-wide section labels.

- `app/globals.css`: 14 `--nw-*` tokens added earlier; today re-pointed legacy semantic tokens to night-watch values in BOTH dark and light themes:
  - Dark: `--red-text` peach `#e8a888` → alarm red `#ff6452`; `--teal-text` slight green shift `#7eda9e` → `#7fe27a`; `--red-bg` slightly darker; `--slate-bg/text` aligned with NW standby
  - Light: `--red-bg` peach `#f4c8a6` → soft pink `#fbeaea`; `--red-text` to readable alarm red `#a8302b`
- Section labels app-wide changed to NW style (size 10, weight 500, `.16em` letter-spacing, `var(--nw-label)` color):
  - NavRail group headers (DAILY / STRATEGIC / META / ARCHIVE)
  - Tasks sidebar sections (SMART VIEWS / SPACES / LISTS / TAGS) + main section headers (This week / Next week / Later / Done) + task detail header
  - Focus tab (HABITS, THIS WEEK'S ACTIONS, complete counter)
  - Notes (TAGS, plus new SMART VIEWS / SPACES added this session)
  - Reflect (all field labels)
  - CloseWeekWizard (via `sed` replacing 3 specific styles)
- **Kept cobalt `--accent`** for buttons, links, active nav, "+ Add" CTAs, brand wordmark. Interactive vocabulary stays cobalt; night-watch is for status display.
- Walkthrough confirmed clean across all tabs in both themes — no regressions, object-palette per-space identity colors preserved on Roadmap.

### OKR summary card restyle (the bridge fix)
- `components/OKRs.tsx`: habit + metric KPI cards lost the colored bg tint. Now quiet `--navy-800` card + 3px left-border in tone color. Hero number 24→28, weight 600→700, with phosphor green/amber/red based on status. Title in `--nw-cream`. "Key metrics" h2 → uppercase amber crumb. Sub-text labels in dim amber uppercase. Tone names: `nominal/caution/alarm/standby`.

### Mobile drawer + responsive fallbacks
- `lib/useIsMobile.ts` (new) — SSR-safe viewport hook, default breakpoint 900px.
- `components/NavRail.tsx` — becomes a fixed slide-in drawer with backdrop on mobile. Nav-row + search-result clicks auto-close. Desktop unchanged.
- `app/hq/page.tsx` — added `isMobile` + `drawerOpen` state. Renders sticky mobile-only top bar with hamburger + brand. Main padding tightens (`16px 14px` vs `24px 28px`).
- `components/Tasks.tsx` — sub-sidebar collapses to dropdown opener showing current scope; tap-to-expand panel; auto-closes on inner click. Detail panel becomes fullscreen overlay (`position:fixed, inset:0, z:50`) so main list gets full viewport.
- `components/Notes.tsx` — both notebook tree AND note list become tap-to-open dropdowns side-by-side. Editor stays as the visible primary pane. Selecting a note auto-closes the list dropdown. After initial deploy the editor was getting squeezed — switched outer layout from CSS Grid to flex column on mobile, made tree/list `flexShrink: 0` with max-height 60vh, editor `flex: 1, minHeight: 0` to absorb remaining viewport.
- `components/Focus.tsx` — habits grid wrapped in `overflow-x: auto` with `min-width: 360px` inside, plus negative margin so the scroll feels edge-to-edge.

### Tasks polish
- **Done section collapse** — `components/Tasks.tsx`: Done section header is clickable button with chevron, hides rows when collapsed. Persisted as `tasks-show-done` in localStorage. Default hidden. Affects space/list/tag scopes only (smart views already filter completed out upstream).
- **Recurring smart view** — `components/Tasks.tsx`: new SmartView `'recurring'` between Inbox and All open. Filter: `t.recurrence_rule != null`. Circular-arrow icon.

### Tasks state lifted to page.tsx
Required for the rail badge + global search. Cleaner long-term — domain state in page.tsx beside everything else.

- `app/hq/page.tsx`:
  - Added `tasks`, `taskLists`, `tagsByTask` state alongside other domain state
  - Added `tasks` + `task_lists` to `loadAll()`'s `Promise.all` with safe per-table fallbacks
  - Second-stage `task_tags` query inside loadAll
  - Extended `SearchResult` type with optional `taskId`
  - Search results include tasks (open first, then done); cap raised 6 → 8
  - Computed `tasksOverdueCount` for NavRail badge (open tasks with `due_date <= today`)
  - Wired `onPickResult` callback to NavRail; routes task picks via `setTasksInitialId`
- `components/NavRail.tsx`:
  - Added `onPickResult?: (r: SearchResult) => void` prop
  - Search-result onClick calls `onPickResult(r)` instead of `onScreenChange(r.screen)`; falls back to old behavior if prop missing
- `components/Tasks.tsx`:
  - Dropped internal `tasks`/`lists`/`tagsByTask`/`loading` state
  - Now receives state + setters as props (function-update form, drop-in compatible with existing mutation sites)
  - Dropped the entire data-load `useEffect`
  - Dropped the "Loading tasks…" splash (page.tsx blocks render until ready)

### Unified Notes Inbox (this session's final feature)
Per-space Inboxes removed entirely; replaced by a single unified Inbox smart view at the top of the sidebar.

- **Migration:** `notes_space_id_nullable` — `ALTER TABLE notes ALTER COLUMN space_id DROP NOT NULL`. Verified via `information_schema.columns`.
- `lib/types.ts`: `Note.space_id: string | null`; `NewNoteInput.space_id?: string | null`.
- `components/Notes.tsx`:
  - **Scope model rewritten:**
    ```
    type Scope =
      | { kind: 'inbox' }                      // unified — no space AND no notebook
      | { kind: 'all' }                        // every note
      | { kind: 'space'; spaceId: string }     // all notes in space (incl. notebooks)
      | { kind: 'notebook'; notebookId: string }
      | { kind: 'tag'; tag: string }
    ```
    Per-space Inbox variant (`{ kind: 'inbox'; spaceId }`) removed entirely.
  - Default scope = `{ kind: 'inbox' }` (was per-space inbox of `activeSpaceId`)
  - **Sidebar layout** now mirrors Tasks:
    - SMART VIEWS section: Inbox (📥) + All notes (∞)
    - SPACES section header (amber)
    - Each space row: chevron toggles expansion, body click sets `{ kind: 'space' }`, hover shows "+" to add notebook, count badge
  - **Counts:** `{ inbox, all, bySpace, byNotebook, byTag }` (was `{ byInbox, byNotebook, byTag }` where `byInbox` was per-space)
  - **`onCreateNote` routes:**
    - Notebook scope → inherit space + notebook
    - Space scope → space only, no notebook
    - Inbox scope → both null
    - Tag/All scope → both null (location-ambiguous fallback)
  - **`onDeleteNotebook` fallback:** when the deleted notebook was the active scope, land on the orphan note's space scope (or unified inbox if no space).
  - **Cross-app jumps** from Tags route to notebook → space → unified inbox depending on where the note lives.
  - `SpaceRow` component extended with `count`, `active`, `onSelect` props; splits chevron click (onToggle, e.stopPropagation) from row body click (onSelect).
- Verified existing data: 4 notes total, 2 in spaces without notebooks (visible via space scope), 2 in notebooks. Unified Inbox starts empty by design.

---

## Recent prior sessions (compressed)

### May 14 — Phase 1 + Phase 2 + scope shift to life management
NavRail desktop-first 240px left rail replacing top + bottom nav. Tasks module v1: DB schema (`tasks` + `task_tags`), recurrence engine in `lib/recurrence.ts` (advance + parseQuickAdd), `lib/db/tasks.ts`, three-pane UI. Cobalt fully closed across light + dark. Mel share bug fix + `space_id=NULL` all-spaces token via SECURITY DEFINER RPC. Phase 1 NavRail + Phase 2 Tasks v1.

### May 10 — closed_at plumbing, two-step ceremonies pattern
Bug-fix session establishing `closed_at` pattern: drafts (Step 1 saved) vs committed (Step 2 finished). `backlog` health-status constraint extended. `done` pill light/dark mode CSS-var-fallback fix. `weekly_reviews.closed_at` migration + backfill.

### May 2 — Cobalt theme + Roadmap done + NoteEntry wrap
Naval → cobalt palette swap (variable names kept, values changed). Roadmap done-state opacity + line-through. NoteEntry preview clamp.

---

## Audit status

| # | Item | Status |
|---|---|---|
| 1 | Centralize KR filters in `lib/krFilters.ts` | ✅ Done |
| 2 | Delete dead builders | ✅ Done |
| 3 | Extract data-mutation layer (`lib/db/*`) | ✅ Done |
| 4 | Extract `useSpaceData(activeSpaceId)` hook | Pending |
| 5 | Design-token module (`lib/tokens.ts`) | Pending — incremental |

### Explicitly NOT doing
Full rewrite, state library, tests, OKRs split, component library.

---

## Current backlog

### 🔴 Possible next session priorities

**1. Re-plan button decision.** Discussed this session, deferred without committing. Currently opens legacy `PlanWeek` modal. Three real options:
   - Remove the button (you already have Close Week + can add actions inline on Focus) — ~10min
   - Point Re-plan at wizard with `closingWeek=current` so full close ceremony runs — ~30min, loses the "no review write" use case
   - Add `mode: 'close' | 'replan'` to wizard with replan starting at step 2, no review write, no seeding — ~1.5hr, leaky abstraction risk
   - **Open question for pickup: do you actually use Re-plan? If you don't, just delete the button + PlanWeek modal.**

**2. KR linker UI on tasks.** `roadmap_item_id` column exists on `tasks`. Add a "Link to KR" picker in the detail panel: dropdown of active KRs in this task's space. Once linked, surface the task on the OKRs tab somewhere (mini list under the KR? open Q). ~1–2hr.

**3. Subtasks UI.** `parent_task_id` is in the schema. Add subtask list in detail panel, render indented child rows in main list. ~2hr.

**4. Phase 3: Notes Tier 2.** Pinned notes (`pinned_at` column exists), internal `[[ ]]` links (parse at render), notebook nesting (schema allows, UI caps at depth 2). Tier 1 is now solid; Tier 2 is the natural next.

### 🟡 Feature backlog

**5. `useSpaceData(activeSpaceId)` hook (audit #4).** Drops ~100 lines from `page.tsx`. ~1hr.

**6. "Plan your first week" for empty spaces** — see Open Decisions.

**7. Quarter close summary.** When the rolling 4Q window advances past a quarter, recap KRs hit, objectives with progress, top wins. ~3–4hr.

**8. Recurring action visual badge on Focus.** Carried. ~30min.

**9. Drag to reorder objectives.** `sort_order` exists. ~2hr.

**10. Drag to reorder tasks.** `sort_order` exists on tasks. ~2hr.

**11. Extract shared `TAG_STYLE` / tag picker.** Duplicated in `Focus.tsx`, `ActionPanel.tsx`, AND `Tasks.tsx`. ~30min.

**12. Propagate done-KR treatment beyond Roadmap.** Strikethrough + 0.45 opacity is Roadmap-only. ~1hr.

**13. Metric card pace-aware status.** Today: zero-checkins → standby. Still off: baseline-only progress with any checkin falls through to alarm. Real fix: compare actual progress to time-elapsed in the quarter. ~1–2hr.

**14. Responsive ActionPanel / ObjectivePanel.** Still desktop-only push-aside at 800px. ~2hr.

### 🟢 Nice to have
- ~~Search space-scoping~~ ✅ shipped Jun 19 as the `in:<space>` palette operator
- Share page query optimization
- PWA install prompt
- Keyboard shortcuts (Cmd+Enter save, Esc close, etc.)
- Reflect history sparkline
- ~~Quick filing affordance on a note (move from Inbox to space/notebook from the editor header)~~ ✅ shipped Jun 19 (Notes quick-file Move)

### ❄️ Deferred indefinitely

- **Multi-user SaaS-ification.** Mel wants to use the app + see Garry's spaces. Needs real RLS, `spaces.owner_user_id` + `space_members(space_id, user_id, role)`, every RLS policy rewritten, invite/signup flow, role-aware UI. 8–20 hours multi-session. Planning doc first.
- **Google Calendar integration.** Full plan in `google-calendar-integration-plan.md`.
- **RLS hardening pass.** `spaces` has RLS disabled entirely. Others use `owner_all USING (true)`. Fine solo, exposed in multi-user.

---

## Parked / open decisions

### "Plan your first week" for empty spaces
Unchanged. Path 1 (AI infra), Path 2 (form-based recovery), Path 3 (improve empty-state CTAs).

### Should `obj.notes` column be migrated/dropped?
Dormant since Apr 27. No urgency.

### Notes editor library
TipTap shipped in Tier 1. Decision locked.

---

## Conventions established this session

Adds to May 14's (desktop-first; SECURITY DEFINER RPCs for anon validation; NULL as a sentinel for "applies broadly"; paired text+structured forms for parseable input; rolling state instead of event log for recurrences; no scope warnings on big projects; no-dep date math precedent):

1. **Cobalt accent for interactive vocabulary, night-watch for status display.** Buttons, links, active nav, brand wordmark, "+ Add" CTAs stay cobalt. Section labels, status chips, hero readouts go night-watch. Mixing is intentional — instrument panels have blue indicator lights too. Don't blow up your interactive vocabulary trying to be aesthetically pure.

2. **Global token re-pointing as a propagation lever.** When a palette evolves and dozens of components reference legacy tokens, re-point the tokens at the new values in globals.css. Per-component edits are reserved for surfaces that need specific identity tokens (the amber-uppercase-crumb label treatment). Saved ~3-4 hours of per-component edits today.

3. **`flex: 1` + `minHeight: 0` for fill-remaining-viewport on mobile.** Notes had a stretching grid-row bug where the editor got squeezed off-screen. The fix was switching the outer container from `display: grid` to `display: flex; flexDirection: column`, with each opener/dropdown getting `flexShrink: 0` and the editor `flex: 1, minHeight: 0`. CSS Grid was unpredictable when most children had `display: none` — auto rows stretched to absorb the viewport.

4. **Hard refresh after deploy.** Vercel edge cache holds CSS sometimes; Ctrl+Shift+R after deploys that touch globals.css or large component restructures.

5. **`onPickResult` callback over `onScreenChange(r.screen)`.** When search results carry deep-link payload (e.g. `taskId`), let the parent route them rather than losing the payload in transit. Fallback path preserves the old "just change screen" behavior if no callback passed.

6. **"Does the underlying need still exist?" before building from backlog.** The Re-plan button was on the backlog from May 10. This session I almost built it before stopping to ask if it earned its complexity. Stay in the habit of interrogating backlog items at decision time — the world changes between when they were filed and when they're picked up.

---

## Spaces reference

| Space name | space_id |
|---|---|
| Stellar (APT) | `f7f2fdd9-bbf6-4f30-ac1f-bd06b81d7d99` |
| VidScrip | `572f74de-d3bf-4aec-831b-c8c2dfb57225` |
| USPSA | `535fb6bd-9a9e-4cdc-8574-ebf61e43e13d` |
| My OKRs | `d759151f-8a6c-4c28-9fe1-db303f4ecf3a` |
| Keeply | `39450371-6432-4700-8f15-20fcd9ca2068` |

**Task lists** (global, no space): App Bugs `ed6849b4-…`, HQ Notes `1102a12c-…`,
Keeply `efd02fa2-…`, Supplies `679e9e5f-…`, **Admin & Compliance** `67d8f402-…` (★ Jun 19),
**Reading** `fa93467f-…` (★ Jun 19).

**Todoist project IDs (for the D3 retirement — delete originals only after HQ confirmed):**
migrated → Admin/Compliance hub `6cGvP9RX4hhMCwvf`, USPSA admin `6X496xw7CVxPpJp8`,
Keeply backlog `6gFfGQ9pffrpQ73V`, Reading `6fgRf5vfrR77cJFV`. **Boat (OUT of scope):**
`6Xh2cH9Hf3JPf9jH` (maintenance), `6fmxC49GhwP78V7v`, `6fmx78xwq7r9mHR9`,
`6fVHc4mmxr3fxVCX`, `6f5CgPgfCjRXMfhc`, `6X3m5rMxhm45cXPg` (Supplies, already migrated).
OKRs project `6gmgfF3847FPPjjJ` stays native.

---

## Deployment workflow

```powershell
cd C:\Users\garry\operation-hq
git pull origin main
Copy-Item -Force C:\Users\garry\Downloads\<file> C:\Users\garry\operation-hq\<path>\<file>
npm run build
git add .
git commit -m "<message>"
git push origin HEAD:main
```

**Rules:** one explicit `Copy-Item -Force` per changed file (never `&&`, never `$env`). All commands in a single fenced block per paste. Literal paths. Push only if build is green.

---

## Tech reference

| Item | Value |
|------|-------|
| Repo | https://github.com/garry-cmd/operation-hq |
| Live URL | https://hq.svirene.com |
| Vercel project | `prj_rgWkigVjdCzawkB3g00GqTIMFTEC` |
| Supabase project | `hepkoszkdwsajfjcedst` |
| Supabase org | `xnlytjeypeozaokqepxp` (Keeply) |
| Node | 24.x |
| Stack | Next.js 16.2.1, React 19, TypeScript 5, Tailwind v4, Turbopack |

**DB tables (May 18 update — `notes.space_id` now nullable):**

```
spaces
  ├── annual_objectives (space_id)
  │     │   .notes — DORMANT since Apr 27; replaced by objective_logs
  │     ├── roadmap_items (space_id, annual_objective_id)
  │     │     .health_status — 'not_started' | 'backlog' | 'on_track' | 'off_track' | 'blocked' | 'done'
  │     │     ├── weekly_actions (roadmap_item_id)
  │     │     ├── habit_checkins (roadmap_item_id)
  │     │     ├── metric_checkins (roadmap_item_id) — UNIQUE(roadmap_item_id, week_start)
  │     │     └── daily_checkins (roadmap_item_id)
  │     ├── objective_links (objective_id)
  │     └── objective_logs (objective_id)
  ├── weekly_reviews (space_id) — UNIQUE(space_id, week_start)
  │     .closed_at — nullable. NULL = draft. NOT NULL = committed.
  ├── tasks (space_id XOR list_id; BOTH NULL = unified Inbox ★ Jun 19 D2)
  │     .roadmap_item_id — optional FK to roadmap_items (KR link; picker shipped Jun 19 D1)
  │     .parent_task_id — self-FK for subtasks (UI shipped Jun 19 D1)
  │     .section_id — FK → task_sections ON DELETE SET NULL ★ Jun 19 D2
  │     .priority — smallint 1–4 (Todoist p1→1 … p4→4)
  │     .estimated_minutes (int) + .deadline_date (date) ★ Jun 19 D1
  │     .due_date + .due_time (time) — split
  │     .recurrence_text + .recurrence_rule (jsonb) — paired (both null OR both set)
  │     .completed_at — null = open. Recurring: always null, due_date rolls forward.
  ├── task_lists — GLOBAL, no space_id (id, name, sort_order) ★ corrected Jun 19
  ├── task_sections (list_id XOR space_id; name, sort_order) ★ NEW Jun 19 D2/space-sections
  │     CHECK task_sections_one_parent = ((list_id IS NOT NULL) <> (space_id IS NOT NULL))
  ├── notebooks (space_id)
  │     .parent_notebook_id — self-FK for nesting
  ├── notes (space_id NULLABLE ★ May 18)
  │     .notebook_id — nullable. notebook_id IS NULL AND space_id IS NULL = unified Inbox
  │     .body — jsonb (TipTap doc)
  └── share_tokens (space_id NULLABLE)
        space_id NULL = all-spaces token

(root) task_tags (task_id, tag) — global tag namespace, no space_id
(root) note_tags (note_id, tag) — global tag namespace
```

**RPC functions:**
- `find_active_share_token(p_token text) RETURNS json` — SECURITY DEFINER. Anon-callable.

**Theme CSS vars (night-watch propagated May 18):**

Dark mode legacy tokens now re-point to night-watch values:
- `--teal-bg/text` → `#0a2014` / `#7fe27a` (phosphor green)
- `--red-bg/text` → `#2e0a08` / `#ff6452` (alarm red)
- `--amber-bg/text` → `#251a08` / `#f5b840` (caution amber)
- `--slate-bg/text` → `#15191f` / `#8e96a8` (standby slate)

Light mode legacy tokens re-pointed:
- `--teal-bg/text` → `#d6f0dc` / `#1a7a3a`
- `--red-bg/text` → `#fbeaea` / `#a8302b`
- `--amber-bg/text` → `#fcf0d4` / `#8a5e08`
- `--slate-bg/text` → `#eef0f4` / `#5f6478`

NW identity tokens (used directly in components for amber instrument labels + hero readouts):
- `--nw-label` / `--nw-label-dim` — amber section labels (`.16em` letter-spacing, weight 500)
- `--nw-cream` — warm cream primary text
- `--nw-hero-amber` — hero readout when in-progress
- `--nw-alarm-text` / `--nw-caution-text` / `--nw-nominal-text` / `--nw-standby-text` — status text

Cobalt `--accent` preserved for interactive elements (buttons, links, active nav, brand wordmark, "+ Add" CTAs).

**Object color palette (unchanged):**
`#0ea5b8` `#14b87f` `#c8a040` `#d4885a` `#c44a7c` `#8b5cf6` `#6b8caa` `#5b8def`

**App scope:** Life management system. Desktop-first. Used many times a day. OKRs + Roadmap (strategic), Focus + Tasks + Notes (daily), Reflect + Parking (archive).

---

## Key files touched today

- `app/globals.css` — semantic-token re-pointing in both themes
- `app/hq/page.tsx` — mobile drawer state, top bar, tasks state lifted, search extended
- `components/CloseWeekWizard.tsx` — pill wrap, hide done KRs, NW labels
- `components/Focus.tsx` — habits scroll wrapper, NW labels
- `components/NavRail.tsx` — mobile drawer, onPickResult callback, NW labels
- `components/Notes.tsx` — mobile dropdowns, unified Inbox scope rewrite, SMART VIEWS + SPACES sections
- `components/ObjectiveCard.tsx` — KR reorder arrows, polish v1, night-watch palette
- `components/OKRs.tsx` — summary card night-watch restyle
- `components/Reflect.tsx` — NW field labels
- `components/Tasks.tsx` — mobile dropdown, Done collapse, Recurring view, state lifted to props
- `lib/types.ts` — Note.space_id nullable
- `lib/useIsMobile.ts` (new) — viewport hook

Migrations applied this session:
- `notes_space_id_nullable` (May 18)
