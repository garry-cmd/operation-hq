# Notes Module — Planning Doc
*Drafted: May 14, 2026 · Updated: Jun 19, 2026 · Status: **Tiers 1–3 substantially shipped — near Evernote parity***

---

## Status (Jun 19, 2026) — near Evernote parity

The module is now a genuine Evernote replacement in daily use. Beyond the original
Tier 1 + unified Inbox (see May 18 status below), the Jun 19 sessions shipped the
rich-content and power-user surface. Full detail in `operation-hq-session-2026-06-19.md`
(Session 2). Summary of what is now **live in production**:

- **Rich content:** inline images (paste/drop/toolbar), file attachments (50 MB,
  download chips), dividers, and **robust tables** with resizing + per-cell background
  colors + bullets/checkboxes inside cells. Media stored in a private `note-media`
  Supabase bucket; bodies persist only the storage **path**, never a URL.
- **Tier 2 (shipped):** **pinned notes** (float to top, 📌), **internal `[[ ]]` links**
  (render-time decoration, resolve by title within space → anywhere, toast on miss).
- **Tier 3 (shipped early):** full-text search (Cmd+K, prior), **Markdown export**,
  **version history** (`note_versions` table, throttled snapshots, reversible restore).
- **Power-user:** **focus mode** (hide NavRail + both panes, widen editor to 1100px),
  **quick-file Move** (relocate a note's space/notebook from the editor header),
  **storage GC** (purge a note's media on delete).
- **Nesting:** sub-notebooks now allowed to depth 3.

**Still deferred (deliberate):** OCR (heavy external pipeline), web clipper (separate
browser-extension product), and the **full visual redesign** (`hq-notes-redesign.html`,
Jun 6 — a strategic whole-app aesthetic call, not a feature-batch item). Residual:
image node-level storage GC (deleting an image mid-edit doesn't GC that one file until
the note is deleted).

**Migrations (Jun 19):** `create_note_media_private_bucket`,
`widen_note_media_for_attachments`, `create_note_versions`.

**New modules:** `lib/db/noteMedia.ts`, `lib/db/noteVersions.ts`,
`lib/notes/imageWithPath.ts`, `lib/notes/fileAttachment.ts`,
`lib/notes/tableWithColor.ts`, `lib/notes/internalLinks.ts`, `lib/notes/noteMarkdown.ts`.


## Status (May 18)

**Tier 1 SHIPPED.** Everything in the original Tier 1 scope is live in production:
- Schema (`notebooks`, `notes`, `note_tags`) — migrated and active
- TipTap editor with StarterKit + TaskList + Placeholder
- Three-pane layout (notebook tree | note list | editor)
- Notebooks nested under spaces (depth capped at 2)
- Title + body, autosave on debounced change
- Create / rename / delete on notebooks and notes
- Mobile fallback: tree + list collapse to togglable dropdowns above the editor (May 18)

**Unified Inbox SHIPPED (May 18).** Departure from the original plan worth flagging:
- `notes.space_id` made nullable via the `notes_space_id_nullable` migration
- Per-space "Inbox" rows removed entirely from the sidebar
- New SMART VIEWS section at top: unified Inbox (📥) + All notes (∞)
- New SPACES section header with amber NW label, mirroring Tasks layout
- Clicking a space row shows all notes in that space (incl. nested notebooks)
- Default scope on entry = unified Inbox (was per-space inbox of active space)
- Sidebar shape now mirrors Tasks for cross-product consistency

**Tier 2 still pending.** See "Roadmap" below for what's next.

---

## TL;DR

Tier 1 is shipped and in daily use as of May 18. Tier 1 took ~2-3 sessions all in. The unified Inbox refactor (originally Tier 3) was pulled forward and shipped May 18 because the per-space Inbox UX was friction. Tier 2 is the natural next: pinned notes, internal `[[ ]]` links, deeper nesting.

The original tier list below describes what was planned; in practice the unified-Inbox UX work jumped ahead of pinned/internal-links because it removed daily friction.

---

## Decide first: which tier?

### Tier 1 — Foundation *(~2 evenings)*
The minimum useful notes module:
- DB: `notebooks` + `notes` tables, plain CRUD
- Three-pane layout: notebook tree | note list | editor
- TipTap editor with starter kit (headings, bullets, checklists, bold/italic, code blocks)
- Notebooks nested under spaces
- Loose notes allowed (no notebook required)
- Title + body, autosave on debounced change
- Create / rename / delete on notebooks and notes

What you get: enough to actually use as a daily notepad. Captures the "Evernote replacement" use case minimally.

### Tier 2 — Richer notes *(~1 evening)*
Builds on Tier 1:
- Pinned notes (`pinned_at` column; float to top of middle pane)
- Tags on notes (cross-space, decoupled from task tags by default — see open Q)
- Internal `[[note title]]` links (parse at render; rename breaks links, accepted trade-off)
- Notebook nesting (parent-child, max 2-3 levels practical)

### Tier 3 — Polish & unification *(deferred, multi-session)*
- Full-text search across notes (`tsvector` column + Postgres FTS; surface in Cmd+K)
- `objective_logs` unification (migrate into notes with `objective_id`)
- Daily-note / journal mode
- File attachments (Supabase Storage)
- Export to markdown

**Don't start here.** Decide if Tier 1+2 ever shipped well enough to justify it.

---

## Decisions baked in

These have answers I'd defend, but flag in "Open questions" if you want to push back.

### Editor library → TipTap
Pros: React-first wrapper, ProseMirror under the hood (battle-tested), block-style natively, extension model for custom nodes (callouts, internal links), good docs. The internal-link extension we'd build is straightforward.

Why not the others:
- **Lexical** — Meta's. Solid, but more configuration overhead and a smaller ecosystem than TipTap for our needs.
- **Slate.js** — had repeated API churn historically. Less stable bet.
- **Markdown-only textarea** — loses checkboxes, callouts, inline tasks. Underpowered for the "real notepad" goal.

### Body storage → JSONB (ProseMirror document)
Store TipTap's native JSON representation in a `jsonb` column. Canonical form for the editor, lossless round-trip. Don't serialize to markdown for storage; convert on export if needed.

A `body_format` column ('tiptap_v1') is included for forward-compat — if we ever swap editors, we have a discriminator.

### Notebooks → real table with self-FK for nesting
`notebooks` table with `parent_notebook_id` nullable self-FK. Allows arbitrary depth in schema; cap depth at 3 in the UI initially. Cleaner than a free-text path column. Reorderable via `sort_order` later.

### Internal links → parse at render
Store body verbatim. `[[note title]]` is parsed at render and resolved by title within the same space. Rename breaks the link string — user has to fix it manually. Solo-user, fine.

If/when this hurts: add a `note_links(source_id, target_id, label)` join table and a resolver that updates labels on rename. Don't preempt.

### `objective_logs` → keep separate (for now)
ObjectivePanel + ActionPanel + the substrate work fine. Notes is a separate beast. Migration touches a lot of code with little immediate payoff. Revisit as a Tier 3 / Phase 4 question once the notes module is real.

If you go this route eventually: `notes` already has a nullable `notebook_id`; add a nullable `objective_id` later, migrate logs, deprecate `objective_logs`. Plan it then.

### Tags → shared namespace with Tasks
A `#urgent` tag on a task and a `#urgent` tag on a note are the same tag. The tag sidebar in Tasks and the (future) tag display in Notes both pull from the same string namespace.

Implementation: a parallel `note_tags(note_id, tag)` table — same shape as `task_tags`. The "namespace" is the union of distinct tag strings across both tables. Aggregation:
```sql
SELECT DISTINCT tag FROM (
  SELECT tag FROM task_tags UNION ALL SELECT tag FROM note_tags
) t ORDER BY tag;
```

Not worth unifying into a single polymorphic `entity_tags` table — touches too much for too little gain solo. Revisit if a third tagged entity type ever appears.

### Loose notes → allowed (no notebook required)
`notes.notebook_id` is nullable. Quick capture lands at the space root, file later (or never). Matches actual daily-notepad usage.

### Empty title → "Untitled"
Strict "Untitled" placeholder in the note list when title is empty. No first-line-of-body fallback. Simpler, more predictable.

### Pinned notes → schema in Tier 1, UI in Tier 2
The `pinned_at` column ships with the initial migration so we don't need a second migration later. UI deferred to Tier 2.

### Slash commands → backlog
TipTap's `/heading`, `/checkbox`, etc. command palette is deferred. The standard toolbar (or just keyboard markdown shortcuts that TipTap supports natively, like `#` for heading) is enough for v1.

---

## Tier 1 step-by-step plan

### 1. NPM deps
```
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-task-list @tiptap/extension-task-item @tiptap/extension-placeholder
```

StarterKit covers headings, paragraphs, bullet/ordered lists, blockquote, code block, bold/italic, history. Task list extensions add checkboxes. Placeholder shows hint text in empty docs.

### 2. Supabase migration
```sql
CREATE TABLE notebooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  parent_notebook_id uuid REFERENCES notebooks(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notebooks_space ON notebooks (space_id);
CREATE INDEX notebooks_parent ON notebooks (parent_notebook_id) WHERE parent_notebook_id IS NOT NULL;

CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  notebook_id uuid REFERENCES notebooks(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT '',
  body jsonb,
  body_format text NOT NULL DEFAULT 'tiptap_v1',
  pinned_at timestamptz,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notes_space ON notes (space_id);
CREATE INDEX notes_notebook ON notes (notebook_id) WHERE notebook_id IS NOT NULL;
CREATE INDEX notes_pinned ON notes (pinned_at) WHERE pinned_at IS NOT NULL;

CREATE TABLE note_tags (
  note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag text NOT NULL,
  PRIMARY KEY (note_id, tag)
);
CREATE INDEX note_tags_tag ON note_tags (tag);

-- updated_at trigger (reuses public.update_updated_at)
CREATE TRIGGER notebooks_set_updated_at BEFORE UPDATE ON notebooks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER notes_set_updated_at BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RLS (matches the rest of the app's posture)
ALTER TABLE notebooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY notebooks_owner_all ON notebooks FOR ALL TO authenticated USING (true) WITH CHECK (true);
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY notes_owner_all ON notes FOR ALL TO authenticated USING (true) WITH CHECK (true);
ALTER TABLE note_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY note_tags_owner_all ON note_tags FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

### 3. Files to create

| File | Purpose |
|---|---|
| `lib/db/notebooks.ts` | CRUD: listAll / listBySpace / create / rename / move / remove |
| `lib/db/notes.ts` | CRUD: listAll / listBySpace / listByNotebook / create / update / remove + body-save helpers + tag helpers (listTagsForNotes / setTags / listAllTags — mirrors `lib/db/tasks.ts`) |
| `components/Notes.tsx` | Three-pane shell; replaces the placeholder |
| `components/notes/NotebookTree.tsx` | Left pane — collapsible tree per space |
| `components/notes/NoteList.tsx` | Middle pane — note list for selected notebook (title + preview + updated_at) |
| `components/notes/NoteEditor.tsx` | Right pane — TipTap instance, title input, debounced save |
| `lib/notesAutosave.ts` | Debounce helper: collects edits, flushes after ~1.5s idle |

### 4. Files to modify

| File | Change |
|---|---|
| `lib/types.ts` | Add `Notebook`, `Note`, `NewNotebookInput`, `NewNoteInput` types |
| `app/hq/page.tsx` | Wire `Notes` screen (already routed via NavRail; just swap the placeholder import) |
| `components/NavRail.tsx` | (Tier 2) badge for note count? Probably not needed |

### 5. UX detail
- **Three panes**: left ~220px (notebook tree), middle ~280px (note list), right flex (editor). Matches Tasks proportions.
- **Per-space sections** in the left pane, just like the rail's space grouping. Each space expands to its notebooks. "Loose notes" appear at the space root (under the space name).
- **New notebook**: small "+ New" affordance on hover of each space row. Inline name input, same pattern as the new-list flow we just shipped.
- **New note**: button at the top of the middle pane. Creates a blank-title note in the currently-selected notebook (or loose if none).
- **Title field**: a plain `<input>` at the top of the right pane, separate from the body. Editing title commits on blur.
- **Body**: TipTap editor fills the rest. Debounced save 1.5s after typing stops. A small "Saved" / "Saving…" indicator (top-right, muted).
- **Empty states**: no notebooks → CTA to create one. No notes in notebook → CTA to create one. No selection → centered "Pick a note" hint.

### 6. Autosave wire
- Title save: on blur.
- Body save: TipTap fires onUpdate on every keystroke. Pipe to a debounce(1500ms) → write to DB.
- On unmount or scope switch: flush immediately. (Otherwise rapid switching loses the last 1.5s.)
- Conflict handling: not needed for solo-user. Last write wins.

---

## Open questions

All resolved May 14, evening. See "Decisions baked in" above for:
- Tags share namespace with Tasks ✓
- Loose notes allowed ✓
- Empty title → "Untitled" only ✓
- Pinned schema in Tier 1, UI in Tier 2 ✓
- Slash commands → backlog ✓

Two remaining open questions are UI-level (resolved in the Tier 1 mockup pass, not before):
- **Notebook nesting depth in UI** — schema allows arbitrary; decide on 2 vs 3 visible levels when mocking the tree.
- **Where does the tag UI live in Notes?** — does Notes get its own tag sidebar (mirroring Tasks), or do tags only show on each note as inline chips? Settle when mocking the three-pane.

---

## Things that will bite if you forget

- **TipTap content is JSON, not HTML.** Don't try to grep the body column for text — write a helper that walks the document tree and extracts plain text for previews, search, etc.
- **Empty TipTap document is `{ type: 'doc', content: [{ type: 'paragraph' }] }`, not `null`.** Distinguish "never edited" (`body IS NULL`) from "edited then cleared" (body has the empty-doc shape) if it matters for empty-state logic.
- **Title can be empty.** UI must handle empty titles gracefully — "Untitled" in the note list, focus the title input on new-note creation.
- **`notebook_id ON DELETE SET NULL`** — deleting a notebook orphans its notes to "loose" rather than cascading delete. Deliberate. If you want cascade behavior, change to `ON DELETE CASCADE` and warn in the UI before delete.
- **Autosave + rapid switching**: flushing on scope/note change is critical. A `useEffect` cleanup or imperative `await flush()` before `setSelectedNoteId(newId)`.
- **TipTap re-mounts on key change**: setting `key={note.id}` on the editor is the simple way to reset state between notes. Avoids "ghost content" from previous note bleeding in.
- **Internal `[[ ]]` link parsing** at render — only resolve within the same space initially, to keep the namespace bounded.
- **Pinned-at sorts after open-at**: when both pinned and unpinned notes exist, pinned first (sorted by `pinned_at DESC`), then unpinned (by `updated_at DESC`). Don't accidentally interleave.

---

## When you come back to this

1. Re-read the "Decide first" section. Has Tier 1 scope shifted?
2. The decisions are locked. Don't relitigate unless something fundamental changed.
3. Mockup the three-pane layout first (per the standing principle). The parts that benefit most from clicking through:
   - Notebook-tree expand/collapse + new-notebook flow
   - New-note flow (where the button lives, what selecting a notebook does)
   - Where the tag UI sits — sidebar like Tasks, or only on each note as chips
4. Block ~2 evenings for Tier 1. Tier 2 can be a third evening if momentum carries.

---

## References (for future-you)

- TipTap React docs: <https://tiptap.dev/docs/editor/getting-started/install/react>
- TipTap StarterKit extensions list: <https://tiptap.dev/docs/editor/extensions/functionality/starterkit>
- TaskList + TaskItem (checkboxes): <https://tiptap.dev/docs/editor/extensions/nodes/task-list>
- ProseMirror document model (what JSONB stores): <https://prosemirror.net/docs/guide/#doc>
- Slash-command extension example (community): <https://github.com/ueberdosis/tiptap/tree/develop/demos/src/Experiments/Commands>
- Postgres `jsonb` query patterns (for future search): <https://www.postgresql.org/docs/current/datatype-json.html>
