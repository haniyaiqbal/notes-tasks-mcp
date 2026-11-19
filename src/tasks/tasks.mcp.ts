import { Injectable } from '@nestjs/common';
import { Resource, Tool, type McpContext } from '@nestjs/mcp';
import { z } from 'zod';
import { currentUserId } from '../mcp/current-user.js';
import { TASK_PRIORITIES, type Task } from './task.entity.js';
import { TasksService } from './tasks.service.js';

// ---- Schemas ----

const taskId = z
  .uuid()
  .describe('The task ID, from list_tasks or create_task.');
const date = z.iso.date().describe('A calendar date, YYYY-MM-DD.');
const priority = z.enum(TASK_PRIORITIES);

const taskOutput = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.enum(['open', 'done']),
  priority,
  dueDate: z.string().nullable(),
  noteId: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
});

const listInput = z.object({
  status: z.enum(['open', 'done', 'all']).default('open'),
  due: z
    .enum(['any', 'overdue', 'today', 'next_7_days', 'no_date'])
    .default('any')
    .describe('Filter by due date, relative to `today`.'),
  priority: priority.optional(),
  today: date
    .optional()
    .describe(
      "Today's date in the user's time zone. Defaults to today in UTC.",
    ),
  limit: z.number().int().min(1).max(100).default(25),
});

const createInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  due_date: date.optional(),
  priority: priority.default('normal'),
  note_id: z
    .uuid()
    .optional()
    .describe('Link the task to one of the user’s notes.'),
});

const updateInput = z.object({
  id: taskId,
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  due_date: date.nullable().optional().describe('null removes the due date.'),
  priority: priority.optional(),
  status: z
    .enum(['open', 'done'])
    .optional()
    .describe('"open" reopens a done task.'),
  note_id: z.uuid().nullable().optional(),
});

/**
 * The tasks part of the MCP server. Scopes: `tasks:read` to read,
 * `tasks:write` to change (write includes read).
 */
@Injectable()
export class TasksMcp {
  constructor(private readonly tasks: TasksService) {}

  @Tool({
    name: 'list_tasks',
    title: 'List tasks',
    description:
      'List the user’s tasks, soonest due and most important first. By default only open tasks. Pass `today` (the user’s local date) for correct "overdue" and "today" filters.',
    inputSchema: listInput,
    outputSchema: z.object({
      tasks: z.array(taskOutput),
      total: z.number(),
      today: z.string(),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    scopes: ['tasks:read'],
  })
  async list(input: z.infer<typeof listInput>, ctx: McpContext) {
    const { items, total, today } = await this.tasks.list(
      currentUserId(ctx),
      input,
    );
    return { tasks: items.map(toOutput), total, today };
  }

  @Tool({
    name: 'create_task',
    title: 'Create a task',
    description:
      'Add a task, optionally with a due date, priority and a linked note.',
    inputSchema: createInput,
    outputSchema: taskOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    scopes: ['tasks:write'],
  })
  async create(input: z.infer<typeof createInput>, ctx: McpContext) {
    const task = await this.tasks.create(currentUserId(ctx), {
      title: input.title,
      description: input.description,
      dueDate: input.due_date,
      priority: input.priority,
      noteId: input.note_id,
    });
    return toOutput(task);
  }

  @Tool({
    name: 'update_task',
    title: 'Edit a task',
    description: 'Change a task. Only the fields you pass are changed.',
    inputSchema: updateInput,
    outputSchema: taskOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    scopes: ['tasks:write'],
  })
  async update(input: z.infer<typeof updateInput>, ctx: McpContext) {
    const task = await this.tasks.update(currentUserId(ctx), input.id, {
      title: input.title,
      description: input.description,
      dueDate: input.due_date,
      priority: input.priority,
      status: input.status,
      noteId: input.note_id,
    });
    return toOutput(task);
  }

  @Tool({
    name: 'complete_task',
    title: 'Complete a task',
    description: 'Mark a task as done. Safe to repeat.',
    inputSchema: z.object({ id: taskId }),
    outputSchema: taskOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    scopes: ['tasks:write'],
  })
  async complete({ id }: { id: string }, ctx: McpContext) {
    return toOutput(await this.tasks.complete(currentUserId(ctx), id));
  }

  @Tool({
    name: 'delete_task',
    title: 'Delete a task',
    description:
      'Permanently delete a task. Prefer complete_task for finished work; confirm with the user before deleting.',
    inputSchema: z.object({ id: taskId }),
    outputSchema: z.object({ deleted: z.literal(true), id: z.string() }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    scopes: ['tasks:write'],
  })
  async remove({ id }: { id: string }, ctx: McpContext) {
    await this.tasks.remove(currentUserId(ctx), id);
    return { deleted: true as const, id };
  }

  @Resource({
    uri: 'tasks://open',
    name: 'open-tasks',
    title: 'Open tasks',
    description: 'All open tasks as a Markdown checklist.',
    mimeType: 'text/markdown',
    scopes: ['tasks:read'],
  })
  async openTasks(_input: unknown, ctx: McpContext) {
    const { items } = await this.tasks.list(currentUserId(ctx), {
      status: 'open',
      due: 'any',
      limit: 100,
    });
    return formatChecklist(items) || 'No open tasks.\n';
  }
}

export function formatChecklist(tasks: Task[]): string {
  return tasks
    .map((t) => {
      const due = t.dueDate ? ` (due ${t.dueDate})` : '';
      const flag = t.priority === 'high' ? ' ‼️' : '';
      return `- [${t.status === 'done' ? 'x' : ' '}] ${t.title}${due}${flag}`;
    })
    .join('\n');
}

function toOutput(task: Task) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    noteId: task.noteId,
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
  };
}
