# Operation HQ — Session Notes
*June 19, 2026 · Four sessions this day. Prepend to / merge into `operation-hq-pickup-notes.md`.*

---

# Session 1 — objective/KR dates + metric card interactions

## TL;DR

Six shipments, one migration, one parked item. Focus was time-windows on the
strategic objects (objectives + KRs) and richer metric KPI cards (sparklines +
flip-to-readings). The Roadmap KR editor was unified onto the shared modal.

## Shipped

1. **Objective start/end dates.**
   - Migration `add_objective_start_end_dates` — `annual_objectives.start_date`,
     `end_date`, both `date`, nullable, **no backfill** (objectives stay dateless
     until set; many are "this year" with no real window).
   - `lib/types.ts`: `AnnualObjective.start_date / end_date: string | null`.
   - `lib/db/objectives.ts`: `NewObjectiveInput` gains optional date fields.
   - OKR card face (`ObjectiveCard.tsx`): quiet range line under the title via
     `formatDateRange`; alarm-red + "· overdue" once `end_date` passes; dateless →
     nothing.
   - Roadmap group header (`Roadmap.tsx`): same range between name and edit pencil.
   - Editable in **both** objective modals — `EditObjectiveModal` (OKRs) and
     `ObjModal` (Roadmap) — Start/End inputs, end-before-start guard (toast in OKRs,
     inline error + disabled save in Roadmap).

2. **Objective "N wk remain" retargeted.**
   - `ObjectiveCard.tsx`: weeks-remaining now counts down to the objective's own
     `end_date` (was quarter close). Null/hidden when dateless or already overdue.

3. **KR date window on roadmap chips.**
   - `Roadmap.tsx` `KRChip`: `formatDateRange(start, end)` sub-line under the title.
     **Neutral** (no overdue-red) — on a quarter grid every past item would light up.

4. **Full KR edit from the Roadmap.**
   - Roadmap's edit path now renders the **shared `EditKRModal`** instead of the
     local stripped-down `KRModal` → full parity (title, health, dates,
     quarter-bound, metric config, delete).
   - `EditKRModal.tsx` extended with two **optional** props: `quarters?: string[]`
     (renders a Quarter selector) and `onPark?: () => void` ("Park it" in footer).
     OKRs + Summary pass neither → unchanged. **Add-KR** still uses the lightweight
     local `KRModal` (EditKRModal is edit-only).
   - Contract: `EditKRModal.onSave` returns a `Partial<RoadmapItem>`; the **parent**
     does `krsDb.update`.

5. **Metric KPI sparklines.** `OKRs.tsx` `MetricKPICard` + `MetricSparkline`:
   quarter-scoped weekly readings, **scaled to own min/max**, colored by
   `sparklineTrend`. Renders only with **≥2** quarter check-ins.

6. **Metric card flip.** Click a metric card → flips (CSS `rotateY`) to its quarter
   readings (date · value · Δ-vs-prior). Cards fixed **168px**; "+ Log" moved to the
   back. Gate: `is_metric`, `quarter === ACTIVE_Q`, not parked/done/abandoned. Habit
   KRs render the simpler percentage card — no flip.

Migration applied: `add_objective_start_end_dates`.

## Parked (Session 1)
- **Daily metric logging** — generalize `metric_checkins` from weekly to dated
  entries. `week_start` is a plain `date`; weekly-ness is **app convention**
  (`MetricLogModal` stamps `getMonday()`), not a schema limit. Plan: rename
  `week_start` → `entry_date` (+ ~4–8 reader files), log modal defaults to **today**,
  Close Week reads the **latest reading in the week**. One migration + ~4 files.

---

# Session 2 — Notes: Evernote-parity pass (media, focus mode, full feature build)

## TL;DR

Large multi-feature session on the Notes module. Started as a gap analysis
(HQ Notes/Tasks vs Evernote/Todoist), then became a sustained build that took the
native Notes editor to **near Evernote parity**: inline images, file attachments,
dividers, robust tables with per-cell colors, a true focus mode, and then a single
big pass adding pinned notes, internal `[[ ]]` links, quick-file move, Markdown
export, version history, and storage garbage-collection. Two regressions were
introduced and fixed same-session (a hooks-order crash and a focus-mode "trap").

## Strategic decision (gap analysis)
- **Evernote → REPLACE** with native Notes (build toward parity).
- **Todoist → WRAP, not replace** (deepen the read-only Focus strip + KR-linking;
  keep Todoist's own apps for mobile capture / reminders). The Todoist write-back
  and tasks-vs-Todoist scope decision was **parked** — Garry chose to proceed with
  the Notes build instead.

## Shipped (in deploy order)

1. **Inline images** (paste / drop / toolbar). Private Supabase bucket `note-media`.
   Body stores only the storage **path** (never a URL) → privacy model swappable
   with zero body rewrites. Display URL resolved at render via signed URLs.
   - `lib/db/noteMedia.ts`: `uploadNoteImage`, `signNoteMedia` (8h TTL).
   - `lib/notes/imageWithPath.ts`: custom Image extension, `path` attr, async
     node-view signs path→src.

2. **File attachments** (PDFs etc., download chips). Bucket widened to any mime,
   50 MB. `lib/notes/fileAttachment.ts` — block atom node, chip = [ext badge][name]
   [size], whole-chip click opens a signed URL (about:blank trick to dodge popup
   blockers), hover "×" removes the node. Filenames surfaced in `lib/noteText.ts`
   so Cmd+K finds them.

3. **Multi-file / overwrite bug fix.** Inserting a block atom leaves it
   node-selected, so the next `insertContent` replaced it (note could hold only one
   item). Fix: upload all first, insert as one array, always `insertContentAt(pos,…)`
   with `pos = at ?? selection.to` (numeric pos never replaces).

4. **Divider** — StarterKit `horizontalRule` (`---` already worked); added a toolbar
   `―` button + `hr` CSS.

5. **Tables** (the Evernote make-or-break). 4 `@tiptap/extension-table*` pkgs (all
   `@3.23.4`, **named** exports in v3). `lib/notes/tableWithColor.ts`:
   resizable Table + color-extended cell/header (`backgroundColor` attr → translucent
   rgba, theme-safe). `CELL_COLORS` palette. Context `TableToolbar` (row/col add/del,
   header, merge, Fill▾ swatch popover, delete table). Default cell `block+` allows
   bullets/checkboxes in cells. Verified live: insert / header / cell-color /
   checkbox-in-cell all persist through reload (JSONB round-trips the color attr).

6. **Table toolbar visibility fix.** TipTap v3 `useEditor` doesn't re-render React on
   selection change → subscribe to `selectionUpdate` and bump a reducer so the
   contextual toolbar shows/hides reliably.

7. **Focus mode** (the editor's fullscreen button, upgraded). Now hides the global
   **NavRail** *and* both Notes panes, and widens the editor column 780 → **1100px**.
   - `Notes.tsx`: `onFocusChange?(focused)` callback; toggle notifies parent.
   - `app/hq/page.tsx`: owns `notesFocus` state; NavRail rendered
     `{!(notesFocus && !isMobile) && <NavRail/>}`; resets on leaving Notes.

8. **Pinned notes.** Pin/unpin from the editor header (icon → cobalt); pinned notes
   float to top of every scope with a 📌. Module-level `byPinnedThenUpdated`
   comparator (pinned first by `pinned_at` desc, then `updated_at`). `pinned_at`
   column already existed. Verified live.

9. **Internal `[[ ]]` links.** `lib/notes/internalLinks.ts` — render-time **decoration**
   plugin (body stores literal `[[Title]]`; search/export/copy see plain text).
   Click resolves by title within the current note's space first, then anywhere;
   toasts on no-match. Dotted cobalt `.note-link` styling. Verified live.
   - **Behavioral note:** plain click *follows* the link (doesn't place the cursor),
     so to edit the bracket text you arrow in from the side. One-line switch to
     Cmd-click-to-follow if it annoys.

10. **Quick-file (Move).** Folder icon → space/notebook picker (`MovePanel`); move a
    note out of Inbox without leaving the editor. `onPatch({space_id, notebook_id})`.
    Verified live: Inbox→Stellar and Stellar→Meetings notebook both persisted.

11. **Export to Markdown.** Download icon → `.md` via `lib/notes/noteMarkdown.ts`
    (headings, marks, task checkboxes `- [x]`, code fences, GitHub tables, image /
    attachment placeholders referencing the storage path since the bucket is private).
    Verified as a pure function.

12. **Version history.** Migration `create_note_versions` (`note_versions` table:
    note_id FK cascade, title, body jsonb, created_at; owner_all RLS).
    `lib/db/noteVersions.ts` — list / create / prune (keep last 50).
    Clock icon → `HistoryPanel` lists snapshots; snapshots taken on real body saves,
    **throttled to once per ~3 min per editor mount** (so ≈ one checkpoint per editing
    session). Restore is behind a `confirm()` and snapshots current state first
    (reversible). Verified live: panel lists; DB confirmed snapshots fire only on real
    edits (a merely-opened note has zero versions — no snapshot-on-open spam).

13. **Storage GC.** `deleteAllMediaForNote(noteId)` purges the `{noteId}/` prefix on
    note delete; removing an attachment chip deletes that file (`deleteNoteMedia`).
    **Residual:** deleting an *image* mid-edit (backspace) doesn't GC that one file —
    cleaned when the note is eventually deleted. Full node-level image GC needs
    body-diffing on save; judged not worth the risk this pass.

14. **Sub-notebook nesting** cap bumped depth 1 → **3** (tree already recursed; only
    the "+ New sub-notebook" menu was gated).

## Bugs introduced + fixed this session
- **React error #310 (hooks order).** The `notesFocus` reset `useEffect` was placed
  **below** the auth early-returns in `page.tsx` (`if (user===undefined) return` /
  `if (!user) return <LoginPage/>`) → conditionally called → runtime crash that the
  build (single SSR path) didn't catch. Fix: move the effect **above** all early
  returns, with the other top-level hooks. **Lesson reinforced: every hook must sit
  above page.tsx's auth early-returns; the build won't catch a violation.**
- **Focus-mode delete trap.** Deleting the open note unmounts the editor (the only
  place the focus-exit button lives) while `notesFocus` stayed true → NavRail + panes
  hidden with no way out. Fix: exit focus on delete, plus a guard effect that drops
  focus whenever the selection clears while focused.

## Migrations applied (Session 2)
- `create_note_media_private_bucket` — private `note-media` bucket, 10 MB, image
  mimes, 3 owner-scoped RLS policies.
- `widen_note_media_for_attachments` — bucket any-mime, 50 MB.
- `create_note_versions` — version-history table + index + owner_all RLS.

## Files of record (Session 2)
- New: `lib/db/noteMedia.ts`, `lib/db/noteVersions.ts`, `lib/notes/imageWithPath.ts`,
  `lib/notes/fileAttachment.ts`, `lib/notes/tableWithColor.ts`,
  `lib/notes/internalLinks.ts`, `lib/notes/noteMarkdown.ts`.
- Modified: `components/Notes.tsx` (the bulk), `app/hq/page.tsx` (focus state),
  `lib/types.ts` (`NoteVersion`), `lib/noteText.ts` (attachment names).

## Deliberately NOT built (with reasons)
- **OCR** — heavy external pipeline (wasm Tesseract or paid API), not parity-critical.
- **Web clipper** — a separate browser-extension product, not an in-app change.
- **Full Notes visual redesign** — strategic whole-app aesthetic decision; the Jun 6
  `hq-notes-redesign.html` mockup deserves its own review, not a silent ship inside a
  feature batch. Still parked pending the whole-app refresh call.

## Notes-specific follow-ups / open
- Restore + the export file-download were not click-verified live (native `confirm()`
  is awkward to drive via automation; export verified as a pure function). Both are
  low-risk; can confirm restore via injected JS later if wanted.
- Internal-link click vs. cursor-placement trade-off (see #9) — flip to Cmd-click on
  request.
- Image node-level storage GC (see #13).
- **Stale repo copy:** `notes-integration-plan.md` in the repo is an old May 14 copy;
  the authoritative version is the Project-knowledge file. Sync or delete the repo
  copy when convenient.

## PWA (carried, unchanged)
App is already a proper PWA (manifest + icons wired in `app/layout.tsx`); install via
browser. No in-app install prompt yet — backlog nicety.

---

# Session 3 — Command Palette: full search rewrite + KR deep-linking

## TL;DR

Replaced the old cramped sidebar search dropdown with a centered ⌘K command
palette and built it out across three tiers plus item-level deep-linking. Search
now spans every entity (objectives, KRs incl. parked, all actions, tasks, notes +
bodies, reflect entries, notebooks, spaces, tags), ranks flat (best match first),
and routes a pick to the **item itself** — switching space, opening the right
panel, jumping to the right week, and for KRs scrolling-to + flashing the row/chip.
Also shipped a version-aware media GC fix for Notes. Six commits, no migrations.
All verified live in Chrome (Browser 1).

## Shipped (in deploy order)

1. **Notes node-level media GC (version-aware).** Deleting an image mid-edit
   (backspace) previously leaked its file in the `note-media` bucket until the whole
   note was deleted; and the attachment-chip remove button deleted files *without*
   checking version snapshots (could break a version restore). Fix: new pure
   `lib/notes/collectMediaPaths.ts` (walks the doc — incl. table cells — collecting
   image+attachment storage `path`s, ignoring external src-only images). `Notes.tsx`
   holds `lastMediaPathsRef` and a `gcRemovedMedia()` run inside `flushBody` after
   save: diff prev→current paths, and for each removed path delete it **only if no
   retained `note_versions` snapshot still references it** (version-aware). Removed
   the inline immediate-delete from `fileAttachment.ts`. No bucket-listing (avoids
   in-flight-upload races). Verified live: orphan GC fires, version-referenced media
   survives, whole-note delete still purges + cascades.

2. **Centered command palette (Tier 1+2).** New `lib/search.ts` (pure ranker) +
   `components/CommandPalette.tsx` (centered modal). Old sidebar dropdown
   (single `.includes()`, source-order, slice(10), no keyboard nav) is gone; the
   NavRail search box is now a trigger button (`onOpenSearch`).
   - **Ranker:** tiered token scoring exact(1000) > prefix(620) > word-boundary(420)
     > substring(240). Field weights title 1.0 / tag 0.72 / container 0.6 / body 0.42.
     KIND_BOOST + recency tiebreak. **Multi-term AND, word-order independent**
     ("sam consolidation" → "Consolidation Meeting with Sam"). `highlightSegments`
     returns React-safe segments (no `dangerouslySetInnerHTML`); `makeSnippet` for
     body context.
   - **Index** (memoised in `page.tsx`): objectives, KRs (incl. parked), ALL actions
     (not just this-week), tasks + descriptions, notes + extracted bodies, reflect
     entries (win/slipped/adjust_notes), notebooks, spaces, tags.
   - **Deep-link routing** (`handleSearchPick`): always `switchSpace` first, then
     objective→panel / action→week-jump+panel / task→detail / note→its container.
   - Palette UI: type chips (All/Objective/Key Result/Action/Task/Note), accent-tinted
     highlight via `--accent-dim`/`--accent`, ↑↓/↵/esc, footer hints.

3. **Action dedup.** Carry-forward spawns one `weekly_actions` row per week with the
   same `(roadmap_item_id, title)` — search showed "Get Rick report" ×4. Index now
   collapses to one entry per that identity, keeping the this-week row else the most
   recent (`week_start` sorts lexically). Verified: `rick` → 1 result.

4. **Tier 3 — operators + fuzzy + recents.**
   - **Scoping operators** via `parseQuery` (non-destructive — raw text stays in the
     box): `#tag` (tag-only), `in:<space>` (matches `entry.spaceName`, shows a cobalt
     `in:` pill), and kind ops `task:`/`note:`/`kr:`/`obj:`/`action:`/`reflect:`/
     `notebook:`/`space:` (reflected in the chips; operator wins over manual chip). A
     **scope-only** query with no tokens (e.g. `in:keeply`, `task:`) lists everything
     in scope by kind+recency.
   - **Fuzzy typo tolerance:** bounded word-level Levenshtein (`withinEdits`), gated to
     tokens ≥3 chars, threshold 1 (len≤4) else 2, scored **90 — below substring(240)**
     so a clean hit always wins. `stellr` → all Stellar items. (Fuzzy matches show no
     highlight — there's no exact span — which is acceptable.)
   - **Recent items:** empty query shows the last 8 opened items under a "RECENT"
     header, persisted in `localStorage['hq-search-recents']`, resolved against the live
     index (stale ids drop out), fully keyboard-navigable.

5. **KR deep-link (scroll-to + flash, with auto-expand).** Picking a KR now routes to
   OKR (active quarter) or Roadmap and scrolls-to + flashes the actual KR.
   - `SearchRoute` gains `krId`; the KR index route carries `krId: i.id` (non-parked).
     `page.tsx` owns `initialKRId`, set in `handleSearchPick`, threaded into `OKRs` +
     `Roadmap` as `initialKRId` / `onConsumeInitialKRId`.
   - New `lib/scrollFlash.ts` `scrollToAndFlash(krId, onSettled, attempts=20)`:
     `querySelector('[data-kr-id="…"]')`, polls 70ms×20 (~1.4s) until the element
     mounts, then `scrollIntoView({block:'center'})` + a 1.5s cobalt box-shadow ring;
     calls `onSettled` once it finds (or gives up) so the caller defers consuming.
   - `data-kr-id` added to the **ObjectiveCard KR row** and the **Roadmap KRChip**.
   - **Gotcha that needed a follow-up commit:** ObjectiveCards default to `collapsed`,
     so the KR row (and its `data-kr-id`) isn't in the DOM. ObjectiveCard now takes
     `expandKRId` and auto-`setCollapsed(false)` when it owns that KR; OKRs passes
     `expandKRId={initialKRId}`. Consume is **deferred until `scrollToAndFlash`
     settles** (not eagerly), so on a cross-space jump `expandKRId` stays live until the
     owning card mounts and expands.
   - Verified live: OKR path (Finances Improved auto-expands, scrolls to "Earning
     $3k/month with Stellar", flashes; only that card's rows are in the DOM) and
     Roadmap path ("Hike 100 miles" chip in the 3Q2026 column flashes).

## Commits (this session, in order)
1. `notes: version-aware node-level media GC (reclaim orphaned images/attachments on save)`
2. `search: centered command palette with ranked multi-source search (Tier 1+2)`
3. `search: dedup carry-forward actions by (roadmap_item_id, title)`
4. `search: Tier 3 — scoping operators (in:/type:), fuzzy typo tolerance, recent items`
5. `search: KR deep-link — scroll-to + flash on OKR/Roadmap`
6. `search: KR deep-link auto-expands owning objective card before scroll-flash`

No migrations.

## Files of record (Session 3)
- New: `lib/search.ts`, `components/CommandPalette.tsx`, `lib/scrollFlash.ts`,
  `lib/notes/collectMediaPaths.ts`.
- Modified: `app/hq/page.tsx` (search index + `handleSearchPick` + `initialKRId`),
  `components/NavRail.tsx` (search box → trigger button), `components/Notes.tsx`
  (media GC), `components/OKRs.tsx` + `components/Roadmap.tsx` (KR deep-link effects),
  `components/ObjectiveCard.tsx` (`data-kr-id` + `expandKRId` auto-expand),
  `lib/notes/fileAttachment.ts` (dropped inline media delete).

## Key learnings (Session 3)
- **ObjectiveCard KR rows are collapse-gated** (`{!collapsed && …}`, default collapsed).
  Anything that needs to target a KR row in the DOM (scroll, measure) must expand the
  owning card first.
- **Deep-link consume timing:** when a pick triggers a cross-space jump, the destination
  screen's data propagates a tick later. Defer clearing the deep-link state until the
  scroll/flash actually settles, so any "expand/select this item" prop stays live for the
  late-mounting target. `scrollToAndFlash`'s `onSettled` callback is the hook.
- **Fuzzy ranks below substring on purpose** — typo tolerance must never outrank a clean
  match. And `highlightSegments` only highlights exact substrings, so fuzzy hits render
  un-highlighted (fine).
- **Action carry-forward identity is `(roadmap_item_id, title)`**, reconfirmed — dedup on
  that, not row id (row id changes each week).
- Recents key: `localStorage['hq-search-recents']` (cap 8, most-recent-first, dedup).

## Parked / not built (Session 3)
- **Notes visual redesign** — the Jun 6 `hq-notes-redesign.html` mockup was rebuilt
  faithfully this session (the original was staged-only and never committed) and remains
  **parked pending a whole-app aesthetic decision**, not a silent feature-batch ship. The
  open call within it: quiet-grey labels (a calm island) vs amber (app-consistent), and
  whether any refresh goes whole-app. Mockup lives in `~/Downloads` /
  `operation-hq-notes-redesign/`, not committed to the repo.
- OCR and web clipper (the latter is a separate browser-extension product, and the
  largest remaining real Evernote gap) — both deliberately deferred.

---

# Session 4 — Kill Todoist: native task surface to parity + Todoist→HQ migration

## TL;DR

The big strategic move: **Todoist WRAP → REPLACE.** Built the native Tasks surface up
to operational parity (durations, deadlines, subtasks, KR-link, **sections** — in lists
*and* spaces), then **migrated 87 non-OKR / non-boat Todoist tasks into HQ** with full
recurrence fidelity, and deduped against pre-existing native tasks. Todoist's own data is
now mirrored natively; only the read-only Focus strip + the Todoist originals remain to
retire (D3). Three schema migrations, ~10 new sections, 2 new lists.

## Shipped (in deploy order)

**D1 — task fields + KR link + subtasks.**
- Migration `tasks_add_estimated_minutes_and_deadline_date` (`estimated_minutes int`,
  `deadline_date date`).
- Duration pills (15/30/45m, 1h/1h30m/2h), **deadline** chip (distinct from due date),
  **subtasks** UI (`parent_task_id`, indented children), **KR-link picker** in the detail
  panel (`roadmap_item_id`). Quick-add tokens extended for duration/deadline.
- **Cross-space KR bug:** `page.tsx` now passes the **all-spaces** roadmapItems + objectives
  to `<Tasks>` so the KR-link picker resolves KRs outside the active space.

**D2 — sections in lists + date-anchored recurrence + inbox fix.**
- Migration `task_sections_and_inbox_container_relax`: `task_sections` table
  (`list_id` FK → task_lists CASCADE, name, sort_order); `tasks.section_id` FK → task_sections
  ON DELETE SET NULL; relaxed `tasks_one_container` to allow **both-null Inbox**
  (`CHECK (NOT (space_id IS NOT NULL AND list_id IS NOT NULL))`).
- Section grouping UI: collapsible headers, add / rename / delete / reorder. New
  `lib/db/taskSections.ts`.
- **Date-anchored recurrence:** `RecurrenceRule.bymonth`; `parseRecurrence` now covers
  month-name + day ("every April 5"), `M/D` ("every 2/5"), and day-of-month ordinals.
  `MONTH_TO_NUM` map added.
- Recurrence-snap **bugfix** (`0e7f230`): `commitRecurrence` + `onQuickAdd` call
  `snapDueDateToRule` so date-anchored rules advance from the right anchor.

**Space-sections — sections can live in spaces too.**
- Migration `task_sections_allow_space_parent`: `task_sections.list_id` made nullable;
  added `task_sections.space_id` FK → spaces CASCADE; CHECK `task_sections_one_parent` =
  `((list_id IS NOT NULL) <> (space_id IS NOT NULL))` (XOR); dropped
  `tasks_section_needs_list`, added `tasks_section_needs_container`.
- **Behavior:** Lists are always section-grouped. **Spaces keep the due-bucket
  (Today/This-week/Later) view until they have ≥1 section**, then flip to section grouping
  — opt-in via a "+ Add section" footer, so the OKR/space task view isn't disrupted by
  default. Space-task detail panel shows the Section picker **and** the Linked-KR picker
  together.

**Todoist → HQ migration (87 tasks).**
- **Scope:** non-OKR, non-boat Todoist projects only. Boat projects OUT (separate domain).
  OKR tasks stay native. The boat **Supplies** project was already migrated (HQ Supplies
  list) — skipped.
- **4 in-scope Todoist projects → HQ:**
  - Admin/Compliance hub (`6cGvP9RX4hhMCwvf`, mixed GM/Vidscrip/USPSA by label) → split by
    label: GM personal → new **Admin & Compliance** list (Bills & Cards / Filings &
    Registrations); Vidscrip → **VidScrip** space · Tax & Compliance; USPSA → **USPSA**
    space · Finance & Ops.
  - USPSA admin/finance (`6X496xw7CVxPpJp8`) → **USPSA** space · Compliance & Filings (9) +
    Finance & Ops.
  - Keeply product backlog (`6gFfGQ9pffrpQ73V`, 48) → **Keeply** space · Backlog (27) /
    Bugs (7) / Growth & Marketing (5) / Vendors / Parts Sources (5) / QA Scenarios (4).
  - Reading (`6fgRf5vfrR77cJFV`, 3) → new **Reading** list.
- **Recurrence fidelity:** translated every Todoist recurrence string through the app's own
  `parseRecurrence` (compiled `lib/recurrence.ts` standalone via `tsc`), giving canonical
  `recurrence_text` + `recurrence_rule` jsonb. **0 unparsed** (32 recurring). Normalizations:
  "every 25" → "every 25th"; strip " at 7:00"; "every 1st tuesday" has no nth-weekday rule →
  best-effort `{freq:monthly,interval:1}` keeping its literal text. Due dates kept as
  Todoist's (NOT snapped — snap anchors interval-monthly to today, destructive). Priority
  p1→1…p4→4; duration→estimated_minutes; due time split from T-timestamps (midnight dropped);
  descriptions carried.
- **Dedup:** the migration overlapped pre-existing native tasks. Removed **5 stale
  predecessors** (created mid-May): `MN Sales Tax return` (VidScrip), `Review Expensify
  Customers` (USPSA), `Update Expensify Amex` (USPSA), `Pay Line of Credit` + `Pay Credit
  Card` (My OKRs). Per Garry, **bills consolidated under Admin & Compliance** (kept migrated
  copies). Intentional same-title survivors: `Quarterly ES` ×4 (distinct quarters),
  `Estimated Tax Payments` ×2 (USPSA vs VidScrip), `Pay LOC` ×2 (10th vs 12th — two lines).
- **Two judgment calls flagged to Garry:** deleted generic `Pay Credit Card` assuming
  BECU CC + Pay Apple card cover it; kept both `Pay LOC` (10th/12th) as distinct.

## Migrations applied (Session 4)
- `tasks_add_estimated_minutes_and_deadline_date`
- `task_sections_and_inbox_container_relax`
- `task_sections_allow_space_parent`
- (migration data inserts done via `execute_sql`, not a tracked migration)

## Containers + sections created (migration targets)
- **Lists:** Admin & Compliance `67d8f402-6527-4386-b035-f170b555d9bc`,
  Reading `fa93467f-619a-40c8-884e-b9212ad9dd76`.
- **Sections:** Bills & Cards `a62b4ca0…`, Filings & Registrations `dd197467…` (Admin list);
  Tax & Compliance `30db4f77…` (VidScrip); Compliance & Filings `16ff8ce6…`, Finance & Ops
  `bdb3c995…` (USPSA); Backlog `2cd02ba1…`, Bugs `a425f2a6…`, Growth & Marketing `310d843f…`,
  Vendors / Parts Sources `41adbc51…`, QA Scenarios `52398f11…` (Keeply).

## Key learnings (Session 4)
- **`task_lists` is GLOBAL** — no `space_id` (id, name, sort_order). `task_sections` takes
  `list_id` XOR `space_id`.
- **Don't snap migrated due dates.** `snapDueDateToRule` anchors interval-only monthly
  ("every 6 months") to *today's* day-of-month — destructive for real future due dates.
  Keep the source app's due date; the rule only governs the next advance. (Snap is correct
  for quick-add, wrong for migration.)
- **Reuse the app's own parser for data migrations.** Compiling `lib/recurrence.ts`
  standalone (`tsc` with a tmp tsconfig: `module commonjs`, `paths @/*`, absolute includes,
  `noEmitOnError:false`) and feeding Todoist's recurrence strings through `parseRecurrence`
  guaranteed the stored `recurrence_rule` matches what the app expects — 0 hand-rolled jsonb.
- **Supabase numerics return as JS strings; `execute_sql` runs as service role** (bypasses
  RLS) — right tool for bulk data inserts. Multi-statement `execute_sql` returns only the
  last result set → verify with a single combined SELECT / CTE RETURNING.
- **Migration dedup is a real step, not an afterthought.** Pre-existing native tasks
  overlapped the import (exact + semantic). Surfaced to Garry before deleting; did not
  silently reconcile.
- `AnnualObjective` uses `.name`, not `.title`.

## Parked / not built (Session 4) — D3 backlog
- **Todoist originals still live in Todoist.** Nothing deleted on the Todoist side yet —
  do that only after Garry confirms HQ looks right, else the Focus strip double-counts.
- **Retire the Todoist Focus strip:** remove `TodoistStrip.tsx` + `/api/todoist/*` proxy +
  the env var, sweep Focus/docs. Gated on the cleanup above.
- **Reminders / push (PWA), mobile capture, email→task** — the "what Todoist still does that
  HQ doesn't" list. Not started.
