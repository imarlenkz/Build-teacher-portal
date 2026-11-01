import { Module } from '@nestjs/common';
import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';
import { StudentImportService } from './student-import.service';

@Module({ providers: [StudentsService, StudentImportService], controllers: [StudentsController], exports: [StudentsService] })
export class StudentsModule {}
