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
        kr_id: { type: 'string', description: 'Link the note to a KR — pass the id from [kr:…]. Pass "none" to unlink. Omit to leave unchanged.' },
        space_id: { type: 'string', description: 'Move the note to a space (to its root) — pass the id from [space:…]. Omit to leave unchanged.' },
      },
      required: ['note_id'],
    },
  },
  {
    name: 'log_metric',
    description: 'Propose logging a reading for a metric KR (one value per week; re-logging the same week overwrites). Use when the operator reports a measurable number for a KR shown as (metric) in the state — e.g. "I ran 12 miles this week".',
    input_schema: {
      type: 'object',
      properties: {
        kr_id: { type: 'string', description: 'The metric KR id from [kr:…] (must be a metric KR).' },
        value: { type: 'number', description: 'The numeric reading, in the KR\u2019s unit.' },
        date: { type: 'string', description: 'Optional date YYYY-MM-DD within the target week; the reading is stored against that week. Defaults to the current week.' },
      },
      required: ['kr_id', 'value'],
    },
  },
  {
    name: 'log_habit',
    description: 'Propose marking a habit KR as done for a day. Use when the operator reports completing a habit shown as (habit) in the state — e.g. "did the gym today".',
    input_schema: {
      type: 'object',
      properties: {
        kr_id: { type: 'string', description: 'The habit KR id from [kr:…] (must be a habit KR).' },
        date: { type: 'string', description: 'Optional date YYYY-MM-DD. Defaults to today.' },
      },
      required: ['kr_id'],
    },
  },
  {
    name: 'create_weekly_action',
    description: 'Propose adding a weekly action under a KR for the current week (the concrete to-do that advances that KR this week). Reference the KR by [kr:…].',
    input_schema: {
      type: 'object',
      properties: {
        kr_id: { type: 'string', description: 'The KR id from [kr:…] this action sits under.' },
        title: { type: 'string', description: 'The action title.' },
      },
      required: ['kr_id', 'title'],
    },
  },
  {
    name: 'create_kr',
    description: 'Propose creating a new KR (key result) under an objective. Reference the objective by the id in [obj:…] in the state. A KR is an outcome by default; set is_habit or is_metric for those flavors.',
    input_schema: {
      type: 'object',
      properties: {
        objective_id: { type: 'string', description: 'The objective id from [obj:…] this KR belongs to.' },
        title: { type: 'string', description: 'The KR title.' },
        is_habit: { type: 'boolean', description: 'True for a recurring habit KR (e.g. "Gym 3x/week"). Default false.' },
        is_metric: { type: 'boolean', description: 'True for a numeric metric KR. Default false.' },
        metric_unit: { type: 'string', description: 'For a metric KR, the unit (e.g. "miles", "lbs", "$").' },
        target_value: { type: 'number', description: 'For a metric KR, the target number.' },
      },
      required: ['objective_id', 'title'],
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
        duration_minutes: { type: 'integer', description: 'Time estimate in minutes (drives how long the task takes on the calendar). Omit to leave unchanged.' },
        deadline_date: { type: 'string', description: 'Hard deadline YYYY-MM-DD (distinct from due_date, which is the planned/scheduled date). Pass "none" to clear. Omit to leave unchanged.' },
        kr_id: { type: 'string', description: 'Link the task to a KR — pass the id from [kr:…]. Pass "none" to unlink. Omit to leave unchanged.' },
        space_id: { type: 'string', description: 'Move the task to a space — pass the id from [space:…]. Omit to leave unchanged.' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'update_kr',
    description: 'Propose editing an existing KR (key result) — rename it, change its time window, or (for a metric KR) change its target or unit. Reference it by the id in [kr:…]. For just the health status use set_kr_health instead. Only pass the fields you want to change.',
    input_schema: {
      type: 'object',
      properties: {
        kr_id: { type: 'string', description: 'The KR id from [kr:…].' },
        title: { type: 'string', description: 'New KR title. Omit to leave unchanged.' },
        start_date: { type: 'string', description: 'New start date YYYY-MM-DD. Pass "none" to clear. Omit to leave unchanged.' },
        end_date: { type: 'string', description: 'New end/target date YYYY-MM-DD. Pass "none" to clear. Omit to leave unchanged.' },
        metric_unit: { type: 'string', description: 'For a metric KR, the unit (e.g. "miles", "lbs", "$"). Omit to leave unchanged.' },
        target_value: { type: 'number', description: 'For a metric KR, the target number. Omit to leave unchanged.' },
      },
      required: ['kr_id'],
    },
  },
  {
    name: 'update_objective',
    description: 'Propose editing an existing objective — rename it or change its time window. Reference it by the id in [obj:…] in the state. Only pass the fields you want to change.',
    input_schema: {
      type: 'object',
      properties: {
        objective_id: { type: 'string', description: 'The objective id from [obj:…].' },
        name: { type: 'string', description: 'New objective name. Omit to leave unchanged.' },
        start_date: { type: 'string', description: 'New start date YYYY-MM-DD. Pass "none" to clear. Omit to leave unchanged.' },
        end_date: { type: 'string', description: 'New end date YYYY-MM-DD. Pass "none" to clear. Omit to leave unchanged.' },
      },
      required: ['objective_id'],
    },
  },
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

// Anthropic-executed server tool: web search. Runs inside the model's turn
// (read-only, no approval needed) so the agent can pull real, current info.
export const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 5 }
