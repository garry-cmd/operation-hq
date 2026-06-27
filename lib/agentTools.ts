/**
 * Shared agent tool schema + proposed-action type. Imported by the server
 * (/api/agent and lib/briefing hand these definitions to Claude) AND by the
 * client executor (lib/agentActions runs an approved proposal). Keep this
 * module dependency-free (pure data + types) so it's safe on both sides.
 *
 * A tool call is a PROPOSAL, never an execution. The model never mutates; the
 * server extracts the calls and the client renders a confirmation card and runs
 * the mutation only on approval.
 */

export const HEALTH_VALUES = ['not_started', 'backlog', 'on_track', 'off_track', 'waiting', 'blocked', 'done']

export interface ProposedAction { tool: string; input: Record<string, unknown> }

export const TOOLS = [
]

// Server-executed READ tools. Unlike TOOLS (propose-first mutations surfaced as
// approval cards) and unlike web_search (an Anthropic server tool), these are
// OUR custom tools that the /api/agent route runs server-side mid-turn and feeds
// back to the model as a tool_result, so the model can reason over the result in
// the same logical turn. Read-only — no approval card. Kept OUT of TOOLS so the
// briefing generator and the client-side proposal executor never see them.
export const READ_TOOLS = [
  {
    name: 'read_note',
    description:
      'Read the full current contents of a note by its [note:…] id. Returns the note\u2019s title and its complete text. Use this BEFORE append_note or update_note when you need to see what the note already contains (so you rewrite/extend it accurately rather than blindly), and whenever the operator asks what a note says, to summarize it, or to pull something out of it. The result comes back to you in the same turn — read first, then answer or propose.',
    input_schema: {
      type: 'object',
      properties: {
        note_id: { type: 'string', description: 'The note id from [note:…] (the value after note:, or the whole [note:…] token).' },
      },
      required: ['note_id'],
    },
  },
]

/** Names of the server-executed read tools — the route runs these in-turn rather than proposing them. */
export const READ_TOOL_NAMES = new Set(READ_TOOLS.map(t => t.name))

// Server-executed MEMORY tools. Like READ_TOOLS, these run server-side inside the
// /api/agent turn (no approval card) — but they WRITE to the agent's long-term
// memory store (the agent_memory table), which is injected back into the system
// prompt every turn by buildAgentContext. Memory only shapes the agent's own
// context; it never touches tasks/KRs/notes/calendar, so it's safe to auto-apply.
// Kept OUT of TOOLS so the briefing generator and client proposal executor never
// see them. The Settings → Memory panel is the human control surface.
export const MEMORY_TOOLS = [
  {
    name: 'remember',
    description:
      'Save a durable fact or preference about the operator to your long-term memory. Use for things that stay true across sessions: how they like to work, recurring constraints, who people are, standing context, decisions. This applies immediately, no approval needed. Do NOT restate something already in your memory list. Keep each memory to one self-contained sentence. Set kind to \'preference\' for behavioral/work preferences, \'fact\' for stable facts about their world, or \'observation\' for time-bound evidence (these may expire). Set source to a brief label like "Scout – 2026-06-26" so Garry can see the provenance.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact or preference to remember, as one clear self-contained sentence.' },
        kind: { type: 'string', enum: ['preference', 'fact', 'observation'], description: 'preference = behavioral/work preference; fact = stable fact about their world; observation = time-bound evidence (short shelf life). Always classify.' },
        source: { type: 'string', description: 'Brief provenance label, e.g. "Scout – 2026-06-26". Always set when writing as the agent.' },
        expires_at: { type: 'string', description: 'ISO timestamp for self-expiry. Set for observations — e.g. 30 days from now. Omit for preferences and facts.' },
      },
      required: ['content', 'kind'],
    },
  },
  {
    name: 'update_memory',
    description: 'Revise a memory you previously saved when the fact has changed or needs correcting. Reference it by the id in [mem:…] in your memory list. Applies immediately, no approval needed.',
    input_schema: {
      type: 'object',
      properties: {
        memory_id: { type: 'string', description: 'The memory id from [mem:…].' },
        content: { type: 'string', description: 'The corrected memory text — replaces the old text entirely.' },
      },
      required: ['memory_id', 'content'],
    },
  },
  {
    name: 'forget',
    description: 'Delete a memory that is no longer true or no longer useful. Reference it by the id in [mem:…] in your memory list. Applies immediately, no approval needed.',
    input_schema: {
      type: 'object',
      properties: {
        memory_id: { type: 'string', description: 'The memory id from [mem:…].' },
      },
      required: ['memory_id'],
    },
  },
]

/** Names of the server-executed memory-write tools. */
export const MEMORY_TOOL_NAMES = new Set(MEMORY_TOOLS.map(t => t.name))

/**
 * Every tool the /api/agent route executes SERVER-SIDE within the turn (reads +
 * memory writes), as opposed to the propose-first mutations in TOOLS that surface
 * as Approve cards. The route partitions a turn's tool calls against this set.
 */
export const SERVER_TOOL_NAMES = new Set<string>([...READ_TOOL_NAMES, ...MEMORY_TOOL_NAMES])

// Anthropic-executed server tool: web search. Runs inside the model's turn
// (read-only, no approval needed) so the agent can pull real, current info.
export const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 5 }
