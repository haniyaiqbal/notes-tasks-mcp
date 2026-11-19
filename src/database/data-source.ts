import { join } from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { Note } from '../notes/note.entity.js';
import { OAuthEntry } from '../oauth/oauth-entry.entity.js';
import { Task } from '../tasks/task.entity.js';
import { User } from '../users/user.entity.js';

/** Shared by the app and the TypeORM CLI, so migrations match the entities. */
export const dataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [User, Note, Task, OAuthEntry],
  // .ts when run through the CLI (tsx), .js once built.
  migrations: [join(import.meta.dirname, 'migrations', '*.{ts,js}')],
} satisfies DataSourceOptions;

export default new DataSource(dataSourceOptions);
