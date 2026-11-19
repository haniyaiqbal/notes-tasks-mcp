import { Injectable } from '@nestjs/common';
import { Resource, ResourceTemplate, Tool, type McpContext } from '@nestjs/mcp';
import { z } from 'zod';
import { currentUserId } from '../mcp/current-user.js';
import type { Note } from './note.entity.js';
import { NotesService } from './notes.service.js';

// ---- Schemas: what the AI sends and gets back ----

const noteId = z
  .uuid()
  .describe('The note ID, from search_notes or create_note.');
const tags = z
  .array(z.string().trim().min(1).max(40))
  .max(20)
  .describe('Tags without "#", e.g. ["work", "ideas"]. Stored lower-case.');

const noteOutput = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string().describe('Markdown.'),
  tags: z.array(z.string()),
  pinned: z.boolean(),
  uri: z.string().describe('Resource URI for this note.'),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const noteSummary = noteOutput.omit({ body: true }).extend({
  preview: z.string().describe('The first 200 characters of the body.'),
});

const searchInput = z.object({
  query: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Words to look for in titles, bodies and tags. Supports "exact phrases", OR, and -excluded words. Leave empty to list recent notes.',
    ),
  tag: z.string().max(40).optional().describe('Only notes with this tag.'),
  limit: z.number().int().min(1).max(50).default(10),
});

const createInput = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(50_000).default('').describe('Markdown.'),
  tags: tags.optional(),
  pinned: z.boolean().optional().describe('Pinned notes are listed first.'),
});

const updateInput = z.object({
  id: noteId,
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().max(50_000).optional().describe('Replaces the whole body.'),
  append_text: z
    .string()
    .max(10_000)
    .optional()
    .describe('Adds text to the end of the body instead of replacing it.'),
  tags: tags.optional().describe('Replaces all tags.'),
  pinned: z.boolean().optional(),
});

/**
 * The notes part of the MCP server: tools to search and change notes, and
 * each note as a readable resource. Scopes: `notes:read` to read,
 * `notes:write` to change (write includes read).
 */
@Injectable()
export class NotesMcp {
  constructor(private readonly notes: NotesService) {}

  @Tool({
    name: 'search_notes',
    title: 'Search notes',
    description:
      "Search the user's notes by words and/or tag. Returns short previews; call get_note for a note's full text.",
    inputSchema: searchInput,
    outputSchema: z.object({ notes: z.array(noteSummary), total: z.number() }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    scopes: ['notes:read'],
  })
  async search(input: z.infer<typeof searchInput>, ctx: McpContext) {
    const { items, total } = await this.notes.search(currentUserId(ctx), input);
    return { notes: items.map(toSummary), total };
  }

  @Tool({
    name: 'get_note',
    title: 'Read a note',
    description: 'Get one note with its full Markdown body.',
    inputSchema: z.object({ id: noteId }),
    outputSchema: noteOutput,
    annotations: { readOnlyHint: true, openWorldHint: false },
    scopes: ['notes:read'],
  })
  async get({ id }: { id: string }, ctx: McpContext) {
    return toOutput(await this.notes.get(currentUserId(ctx), id));
  }

  @Tool({
    name: 'create_note',
    title: 'Create a note',
    description: 'Save a new note. Use Markdown for formatting.',
    inputSchema: createInput,
    outputSchema: noteOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    scopes: ['notes:write'],
  })
  async create(input: z.infer<typeof createInput>, ctx: McpContext) {
    return toOutput(await this.notes.create(currentUserId(ctx), input));
  }

  @Tool({
    name: 'update_note',
    title: 'Edit a note',
    description:
      'Change a note. Only the fields you pass are changed. Use append_text to add to the end without rewriting the body.',
    inputSchema: updateInput,
    outputSchema: noteOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    scopes: ['notes:write'],
  })
  async update(
    { id, append_text, ...changes }: z.infer<typeof updateInput>,
    ctx: McpContext,
  ) {
    const note = await this.notes.update(currentUserId(ctx), id, {
      ...changes,
      appendText: append_text,
    });
    return toOutput(note);
  }

  @Tool({
    name: 'delete_note',
    title: 'Delete a note',
    description:
      'Permanently delete a note. This cannot be undone: confirm with the user first. Tasks linked to it are kept.',
    inputSchema: z.object({ id: noteId }),
    outputSchema: z.object({ deleted: z.literal(true), id: z.string() }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    scopes: ['notes:write'],
  })
  async remove({ id }: { id: string }, ctx: McpContext) {
    await this.notes.remove(currentUserId(ctx), id);
    return { deleted: true as const, id };
  }

  @ResourceTemplate({
    uriTemplate: 'note://{id}',
    name: 'note',
    title: 'Note',
    description: 'One note as Markdown.',
    mimeType: 'text/markdown',
    scopes: ['notes:read'],
  })
  async readNote({ id }: { id: string }, ctx: McpContext) {
    const note = await this.notes.get(currentUserId(ctx), z.uuid().parse(id));
    const tagLine = note.tags.length
      ? `\n\nTags: ${note.tags.map((t) => `#${t}`).join(' ')}`
      : '';
    return `# ${note.title}\n\n${note.body}${tagLine}\n`;
  }

  @Resource({
    uri: 'notes://pinned',
    name: 'pinned-notes',
    title: 'Pinned notes',
    description:
      "The user's pinned notes, in full. Useful as standing context.",
    mimeType: 'text/markdown',
    scopes: ['notes:read'],
  })
  async pinned(_input: unknown, ctx: McpContext) {
    const { items } = await this.notes.search(currentUserId(ctx), {
      limit: 50,
    });
    const pinned = items.filter((n) => n.pinned);
    if (!pinned.length) return 'No pinned notes.\n';
    return (
      pinned.map((n) => `# ${n.title}\n\n${n.body}`).join('\n\n---\n\n') + '\n'
    );
  }
}

function toOutput(note: Note) {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    tags: note.tags,
    pinned: note.pinned,
    uri: `note://${note.id}`,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

function toSummary(note: Note) {
  const { body, ...rest } = toOutput(note);
  return {
    ...rest,
    preview: body.length > 200 ? `${body.slice(0, 200)}…` : body,
  };
}
