import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Note } from './note.entity.js';

export interface NoteSearch {
  query?: string;
  tag?: string;
  limit: number;
}

/**
 * Plain business logic, the same whether it's called by an MCP tool, a
 * REST controller or a job. Every method takes the user ID and filters by
 * it: there is no way to read or change another user's notes.
 */
@Injectable()
export class NotesService {
  constructor(
    @InjectRepository(Note) private readonly notes: Repository<Note>,
  ) {}

  /**
   * Full-text search (Postgres `websearch_to_tsquery`, so "budget -draft"
   * and "exact phrase" work), with a plain substring match as a fallback
   * for partial words. Best matches first; pinned notes win ties.
   */
  async search(userId: string, { query, tag, limit }: NoteSearch) {
    const qb = this.notes
      .createQueryBuilder('n')
      .where('n.user_id = :userId', { userId });

    if (tag) qb.andWhere(':tag = ANY(n.tags)', { tag: normalizeTag(tag) });
    if (query?.trim()) {
      const document = `to_tsvector('simple', n.title || ' ' || n.body || ' ' || array_to_string(n.tags, ' '))`;
      qb.andWhere(
        `(${document} @@ websearch_to_tsquery('simple', :query) OR n.title ILIKE :like OR n.body ILIKE :like)`,
        { query, like: `%${escapeLike(query.trim())}%` },
      )
        .addSelect(
          `ts_rank(${document}, websearch_to_tsquery('simple', :query))`,
          'rank',
        )
        .orderBy('rank', 'DESC');
    }
    qb.addOrderBy('n.pinned', 'DESC')
      .addOrderBy('n.updated_at', 'DESC')
      .limit(limit);

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  async get(userId: string, id: string): Promise<Note> {
    const note = await this.notes.findOneBy({ id, userId });
    if (!note) throw new NotFoundException(`Note ${id} not found`);
    return note;
  }

  create(
    userId: string,
    data: { title: string; body?: string; tags?: string[]; pinned?: boolean },
  ) {
    return this.notes.save(
      this.notes.create({
        userId,
        title: data.title,
        body: data.body ?? '',
        tags: normalizeTags(data.tags),
        pinned: data.pinned ?? false,
      }),
    );
  }

  async update(
    userId: string,
    id: string,
    changes: {
      title?: string;
      body?: string;
      tags?: string[];
      pinned?: boolean;
      appendText?: string;
    },
  ) {
    const note = await this.get(userId, id);
    if (changes.title !== undefined) note.title = changes.title;
    if (changes.body !== undefined) note.body = changes.body;
    if (changes.appendText) {
      note.body = note.body
        ? `${note.body}\n\n${changes.appendText}`
        : changes.appendText;
    }
    if (changes.tags !== undefined) note.tags = normalizeTags(changes.tags);
    if (changes.pinned !== undefined) note.pinned = changes.pinned;
    return this.notes.save(note);
  }

  async remove(userId: string, id: string): Promise<void> {
    const { affected } = await this.notes.delete({ id, userId });
    if (!affected) throw new NotFoundException(`Note ${id} not found`);
  }

  /** Notes changed in the last N days, newest first. */
  recent(userId: string, days: number, limit = 20) {
    return this.notes
      .createQueryBuilder('n')
      .where('n.user_id = :userId', { userId })
      .andWhere(`n.updated_at >= now() - make_interval(days => :days)`, {
        days,
      })
      .orderBy('n.updated_at', 'DESC')
      .take(limit)
      .getMany();
  }
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/^#/, '');
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map(normalizeTag).filter(Boolean))];
}

/** So a search for "50%" matches "50%", not everything. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
