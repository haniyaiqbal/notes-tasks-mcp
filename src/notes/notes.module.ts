import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Note } from './note.entity.js';
import { NotesMcp } from './notes.mcp.js';
import { NotesService } from './notes.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Note])],
  providers: [NotesService, NotesMcp],
  exports: [NotesService],
})
export class NotesModule {}
