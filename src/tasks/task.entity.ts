import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Note } from '../notes/note.entity.js';
import { User } from '../users/user.entity.js';

export const TASK_STATUSES = ['open', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

@Entity({ name: 'tasks' })
@Index(['userId', 'status', 'dueDate'])
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'varchar', length: 8, default: 'open' })
  status: TaskStatus;

  @Column({ type: 'varchar', length: 8, default: 'normal' })
  priority: TaskPriority;

  /** A calendar date (YYYY-MM-DD), no time of day. */
  @Column({ type: 'date', name: 'due_date', nullable: true })
  dueDate: string | null;

  /** Optional link to the note this task came from. */
  @Column({ type: 'uuid', name: 'note_id', nullable: true })
  noteId: string | null;

  @ManyToOne(() => Note, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'note_id' })
  note?: Note;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
