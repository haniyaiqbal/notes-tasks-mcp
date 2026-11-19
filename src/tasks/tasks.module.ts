import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotesModule } from '../notes/notes.module.js';
import { Task } from './task.entity.js';
import { TasksMcp } from './tasks.mcp.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Task]), NotesModule],
  providers: [TasksService, TasksMcp],
  exports: [TasksService],
})
export class TasksModule {}
