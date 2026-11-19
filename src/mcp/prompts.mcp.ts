import { Injectable } from '@nestjs/common';
import { Prompt, type McpContext } from '@nestjs/mcp';
import { z } from 'zod';
import { NotesService } from '../notes/notes.service.js';
import { formatChecklist } from '../tasks/tasks.mcp.js';
import { TasksService } from '../tasks/tasks.service.js';
import { currentUserId } from './current-user.js';

/**
 * Ready-made prompts the user can pick in their AI app (often shown as
 * slash commands). Each one pulls in the user's real data, so the AI starts
 * with the right context instead of having to ask for it.
 */
@Injectable()
export class PromptsMcp {
  constructor(
    private readonly notes: NotesService,
    private readonly tasks: TasksService,
  ) {}

  @Prompt({
    name: 'daily_briefing',
    title: 'Daily briefing',
    description: 'Plan today from your overdue and upcoming tasks.',
    argsSchema: z.object({
      today: z.iso
        .date()
        .optional()
        .describe("Today's date (YYYY-MM-DD). Defaults to UTC."),
    }),
    scopes: ['tasks:read'],
  })
  async dailyBriefing({ today }: { today?: string }, ctx: McpContext) {
    const userId = currentUserId(ctx);
    const base = { status: 'open' as const, today, limit: 50 };
    const [overdue, dueToday, upcoming, undated] = await Promise.all([
      this.tasks.list(userId, { ...base, due: 'overdue' }),
      this.tasks.list(userId, { ...base, due: 'today' }),
      this.tasks.list(userId, { ...base, due: 'next_7_days' }),
      this.tasks.list(userId, { ...base, due: 'no_date', limit: 10 }),
    ]);
    const section = (
      title: string,
      list: { items: Parameters<typeof formatChecklist>[0] },
    ) => `## ${title}\n${formatChecklist(list.items) || '_None_'}`;

    return [
      `Today is ${dueToday.today}. Here are my tasks:`,
      section('Overdue', overdue),
      section('Due today', dueToday),
      section('Due in the next 7 days', {
        items: upcoming.items.filter((t) => t.dueDate !== dueToday.today),
      }),
      section('No due date (first 10)', undated),
      'Suggest a realistic plan for today: what to do first, what can wait, and anything overdue I should reschedule. Keep it short.',
    ].join('\n\n');
  }

  @Prompt({
    name: 'weekly_review',
    title: 'Weekly review',
    description:
      'Look back at the past 7 days: what got done, what is still open, and recent notes.',
    scopes: ['tasks:read', 'notes:read'],
  })
  async weeklyReview(_args: unknown, ctx: McpContext) {
    const userId = currentUserId(ctx);
    const [done, open, notes] = await Promise.all([
      this.tasks.completedSince(userId, 7),
      this.tasks.list(userId, { status: 'open', due: 'any', limit: 50 }),
      this.notes.recent(userId, 7),
    ]);
    return [
      'Help me with my weekly review.',
      `## Done this week (${done.length})\n${formatChecklist(done) || '_Nothing_'}`,
      `## Still open (${open.total})\n${formatChecklist(open.items) || '_Nothing_'}`,
      `## Notes edited this week\n${notes.map((n) => `- ${n.title} (note://${n.id})`).join('\n') || '_None_'}`,
      'Summarise what I achieved, point out anything that has been open too long, and suggest my top 3 priorities for next week.',
    ].join('\n\n');
  }

  @Prompt({
    name: 'summarize_notes',
    title: 'Summarise notes',
    description:
      'Summarise the notes with a tag (or the most recent ones) and pull out action items.',
    argsSchema: z.object({
      tag: z.string().max(40).optional().describe('Only notes with this tag.'),
    }),
    scopes: ['notes:read'],
  })
  async summarizeNotes({ tag }: { tag?: string }, ctx: McpContext) {
    const { items } = await this.notes.search(currentUserId(ctx), {
      tag,
      limit: 15,
    });
    const body = items
      .map((n) => `### ${n.title}\n${n.body.slice(0, 2000)}`)
      .join('\n\n');
    return [
      `Here are my ${tag ? `notes tagged #${tag}` : 'most recent notes'}:`,
      body || '_No notes found._',
      'Summarise them in a few bullet points, then list any action items. For each action item, offer to create it as a task with create_task.',
    ].join('\n\n');
  }
}
