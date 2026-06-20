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
  {
    name: 'complete_task',
    description: 'Propose marking a task as done. Use the task id shown in [task:…] in the state.',
    input_schema: {
      type: 'object',
      properties: { task_id: { type: 'string', description: 'The task id (the value after task: in the bracket, or the whole [task:…] token).' } },
      required: ['task_id'],
    },
  },
  {
    name: 'reschedule_task',
    description: 'Propose changing a task\u2019s due date.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The task id from [task:…].' },
        due_date: { type: 'string', description: 'New due date, YYYY-MM-DD.' },
      },
      required: ['task_id', 'due_date'],
    },
  },
  {
    name: 'add_task',
    description: 'Propose creating a new task. Optionally assign it to a space and a due date.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title.' },
        space_id: { type: 'string', description: 'Optional space id from [space:…]. Omit for an inbox task.' },
        due_date: { type: 'string', description: 'Optional due date, YYYY-MM-DD.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'set_kr_health',
    description: 'Propose changing a KR\u2019s health status (e.g. mark it on_track or blocked).',
    input_schema: {
      type: 'object',
      properties: {
        kr_id: { type: 'string', description: 'The KR id from [kr:…].' },
        health: { type: 'string', enum: HEALTH_VALUES, description: 'New health status.' },
      },
      required: ['kr_id', 'health'],
    },
  },
  {
    name: 'create_calendar_event',
    description: 'Propose adding an event to the calendar (writes to the HQ Google calendar on approval). Use for meetings, plans, social events, appointments, or time blocks. Pick a sensible time if the user didn\u2019t specify one.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title, e.g. "Dinner with Melissa — Sirens Pub".' },
        date: { type: 'string', description: 'Event date, YYYY-MM-DD.' },
        start_time: { type: 'string', description: '24-hour start time HH:MM, e.g. "18:00".' },
        end_time: { type: 'string', description: '24-hour end time HH:MM, e.g. "20:00".' },
      },
      required: ['title', 'date', 'start_time', 'end_time'],
    },
  },
  {
    name: 'create_note',
    description: 'Propose creating a note — for capturing information, meeting notes, ideas, summaries, comparisons, or reference material the operator should keep. The note is created on approval. Prefer this over a task when the content is something to record/read rather than to do.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Note title.' },
        body: { type: 'string', description: 'Note body in Markdown. Supported: headings (#, ##), bold/italic/strikethrough, inline code and fenced code blocks, bullet and numbered lists, checkboxes (- [ ] / - [x]), blockquotes, horizontal rules (---), and tables using GitHub pipe syntax (| col | col | with a |---|---| separator row). Use real Markdown structure — e.g. an actual table — rather than describing it.' },
        space_id: { type: 'string', description: 'Optional space id from [space:…]. Omit for a loose Inbox note.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'append_note',
    description: 'Propose adding content to the END of an existing note (keeps everything already there). Use for "add this to my … note". Reference the note by the id in [note:…] in the state.',
    input_schema: {
      type: 'object',
      properties: {
        note_id: { type: 'string', description: 'The note id from [note:…].' },
        body: { type: 'string', description: 'Markdown to append (same Markdown support as create_note, including tables and checkboxes).' },
      },
      required: ['note_id', 'body'],
    },
  },
  {
    name: 'update_note',
    description: 'Propose editing an existing note — rename it and/or REPLACE its entire body. Use to rewrite or restructure. To merely add to a note without losing its content, use append_note instead. Reference by [note:…].',
    input_schema: {
      type: 'object',
      properties: {
        note_id: { type: 'string', description: 'The note id from [note:…].' },
        title: { type: 'string', description: 'New title. Omit to leave the title unchanged.' },
        body: { type: 'string', description: 'New body in Markdown — REPLACES the existing body entirely. Omit to leave the body unchanged. Same Markdown support as create_note.' },
      },
      required: ['note_id'],
    },
  },
  {
    name: 'update_task',
    description: 'Propose editing an existing task — its title, due date, priority, or description. Reference by [task:…]. (For just the due date, reschedule_task is also fine; for marking it done use complete_task.)',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The task id from [task:…].' },
        title: { type: 'string', description: 'New title. Omit to leave unchanged.' },
        due_date: { type: 'string', description: 'New due date YYYY-MM-DD. Omit to leave unchanged.' },
        priority: { type: 'integer', description: 'Priority 1 (highest) to 4 (lowest). Omit to leave unchanged.', enum: [1, 2, 3, 4] },
        description: { type: 'string', description: 'New description / notes for the task. Omit to leave unchanged.' },
      },
      required: ['task_id'],
    },
  },
]

// Anthropic-executed server tool: web search. Runs inside the model's turn
// (read-only, no approval needed) so the agent can pull real, current info.
export const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 5 }
