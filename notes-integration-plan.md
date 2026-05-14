# Notes Module — Planning Doc
*Drafted: May 14, 2026 · Status: decisions locked, awaiting build · Updated: May 14, 2026 (evening)*

---

## TL;DR

A real notes module — Evernote-style, three-pane (notebooks · note list · editor) — is a **multi-session project**. The hard parts are picking the editor library, settling the schema, and deciding what (if anything) to do about `objective_logs`. Once those are nailed, Tier 1 is ~2 evenings.

Tier list below mirrors the calendar plan. Start small, validate, grow.

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

### Nesting → 2 levels, Stack → Notebook
Evernote model. A top-level notebook with children is conceptually a **Stack** (a grouping); a leaf notebook holds notes. UI caps depth at 2 — no sub-sub-notebooks. Schema stays a single `notebooks` table with `parent_notebook_id` self-FK; the cap is enforced in UI (no "+ New notebook" affordance on already-nested notebooks).

Both stacks and leaf notebooks can hold notes (loose model). If we want to enforce "stacks are pure containers" later, add a trigger or CHECK constraint then.

### Tag UI → both
Tag chips appear inline on each note (in the middle pane and in the editor header), AND a Tags section in the left pane mirrors the Tasks sidebar. Same global tag namespace shared with Tasks.

### Editor toolbar → fixed
Small fixed toolbar at the top of the editor: heading, bold, italic, lists, checklist, code, quote, link. No floating bubble menu (yet). Keyboard markdown shortcuts that TipTap supports natively (`#`, `*`, `-`) still work.

### "Loose notes" → "Inbox"
Notes with no notebook live in an "Inbox" row under each space, matching the Tasks vocabulary.

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

All resolved. See "Decisions baked in" above.

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
