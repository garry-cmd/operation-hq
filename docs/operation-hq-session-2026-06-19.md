# Operation HQ — Session Notes
*June 19, 2026 · Two sessions this day. Prepend to / merge into `operation-hq-pickup-notes.md`.*

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
