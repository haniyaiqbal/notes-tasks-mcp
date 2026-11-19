import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotesService } from '../notes/notes.service.js';
import { Task, type TaskPriority, type TaskStatus } from './task.entity.js';

export type DueFilter = 'any' | 'overdue' | 'today' | 'next_7_days' | 'no_date';

export interface TaskFilter {
  status: TaskStatus | 'all';
  due: DueFilter;
  priority?: TaskPriority;
  /** Today's date (YYYY-MM-DD) in the user's time zone. Defaults to UTC. */
  today?: string;
  limit: number;
}

export interface TaskInput {
  title: string;
  description?: string;
  dueDate?: string | null;
  priority?: TaskPriority;
  noteId?: string | null;
}

/** Same rule as notes: every query is filtered by the user's ID. */
@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    private readonly notes: NotesService,
  ) {}

  async list(userId: string, filter: TaskFilter) {
    const today = filter.today ?? new Date().toISOString().slice(0, 10);
    const qb = this.tasks
      .createQueryBuilder('t')
      .where('t.user_id = :userId', { userId });

    if (filter.status !== 'all')
      qb.andWhere('t.status = :status', { status: filter.status });
    if (filter.priority)
      qb.andWhere('t.priority = :priority', { priority: filter.priority });
    switch (filter.due) {
      case 'overdue':
        qb.andWhere('t.due_date < :today', { today });
        break;
      case 'today':
        qb.andWhere('t.due_date = :today', { today });
        break;
      case 'next_7_days':
        qb.andWhere(`t.due_date BETWEEN :today AND (:today::date + 7)`, {
          today,
        });
        break;
      case 'no_date':
        qb.andWhere('t.due_date IS NULL');
        break;
    }

    // Soonest due first, then most important.
    qb.orderBy('t.due_date', 'ASC', 'NULLS LAST')
      .addOrderBy(
        `CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END`,
        'ASC',
      )
      .addOrderBy('t.created_at', 'ASC')
      .limit(filter.limit);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, today };
  }

  async get(userId: string, id: string): Promise<Task> {
    const task = await this.tasks.findOneBy({ id, userId });
    if (!task) throw new NotFoundException(`Task ${id} not found`);
    return task;
  }

  async create(userId: string, input: TaskInput) {
    await this.checkNote(userId, input.noteId);
    return this.tasks.save(
      this.tasks.create({
        userId,
        title: input.title,
        description: input.description ?? '',
        dueDate: input.dueDate ?? null,
        priority: input.priority ?? 'normal',
        noteId: input.noteId ?? null,
      }),
    );
  }

  async update(
    userId: string,
    id: string,
    changes: Partial<TaskInput> & { status?: TaskStatus },
  ) {
    const task = await this.get(userId, id);
    await this.checkNote(userId, changes.noteId);
    if (changes.title !== undefined) task.title = changes.title;
    if (changes.description !== undefined)
      task.description = changes.description;
    if (changes.dueDate !== undefined) task.dueDate = changes.dueDate;
    if (changes.priority !== undefined) task.priority = changes.priority;
    if (changes.noteId !== undefined) task.noteId = changes.noteId;
    if (changes.status !== undefined && changes.status !== task.status) {
      task.status = changes.status;
      task.completedAt = changes.status === 'done' ? new Date() : null;
    }
    return this.tasks.save(task);
  }

  /** Safe to call twice: completing a done task changes nothing. */
  complete(userId: string, id: string) {
    return this.update(userId, id, { status: 'done' });
  }

  async remove(userId: string, id: string): Promise<void> {
    const { affected } = await this.tasks.delete({ id, userId });
    if (!affected) throw new NotFoundException(`Task ${id} not found`);
  }

  /** Done in the last N days. */
  completedSince(userId: string, days: number) {
    return this.tasks
      .createQueryBuilder('t')
      .where('t.user_id = :userId AND t.status = :done', {
        userId,
        done: 'done',
      })
      .andWhere('t.completed_at >= now() - make_interval(days => :days)', {
        days,
      })
      .orderBy('t.completed_at', 'DESC')
      .getMany();
  }

  /** A task can only link to one of the same user's notes. */
  private async checkNote(userId: string, noteId: string | null | undefined) {
    if (!noteId) return;
    try {
      await this.notes.get(userId, noteId);
    } catch {
      throw new BadRequestException(`Note ${noteId} not found`);
    }
  }
}
