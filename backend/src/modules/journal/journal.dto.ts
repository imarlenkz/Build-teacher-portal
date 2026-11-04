import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { IsDateStr } from '../../common/dto/validators';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class JournalQuery {
  @Type(() => Number) @IsInt() classId: number;
  @Type(() => Number) @IsInt() subjectId: number;
  @Type(() => Number) @IsInt() quarterId: number;
  /** Пән топтарға бөлінсе — міндетті. */
  @IsOptional() @Type(() => Number) @IsInt() groupId?: number | null;
}

export class JournalYearQuery {
  @Type(() => Number) @IsInt() classId: number;
  @Type(() => Number) @IsInt() subjectId: number;
  @IsOptional() @Type(() => Number) @IsInt() groupId?: number | null;
}

export class JournalExportQuery extends JournalQuery {
  @IsOptional() @IsIn(['csv', 'xlsx']) format: 'csv' | 'xlsx' = 'xlsx';
}

export class ColumnInput {
  @IsDateStr() date: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) topic?: string | null;
}

export class CreateColumnInput extends ColumnInput {
  @Type(() => Number) @IsInt() classId: number;
  @Type(() => Number) @IsInt() subjectId: number;
  @Type(() => Number) @IsInt() quarterId: number;
  @IsOptional() @Type(() => Number) @IsInt() groupId?: number | null;
}

export class MarkInput {
  @Type(() => Number) @IsInt() columnId: number;
  @Type(() => Number) @IsInt() studentId: number;
  /** null — бағаны өшіру. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10) value?: number | null;
}

export class HomeworkInput {
  @Type(() => Number) @IsInt() columnId: number;
  @Type(() => Number) @IsInt() studentId: number;
  /** true — үй тапсырмасын орындады, false — белгіні алып тастау. */
  @IsBoolean() done: boolean;
}

export class SaveMarksInput extends JournalQuery {
  @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => MarkInput) marks: MarkInput[];
  /** Үй тапсырмасы белгілері (тек өзгергендері). */
  @IsOptional() @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => HomeworkInput) homework?: HomeworkInput[];
}

export class FinalInput {
  @Type(() => Number) @IsInt() studentId: number;
  /** null — қойылған бағаны алып тастау. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(2) @Max(5) mark?: number | null;
}

export class SaveFinalsInput extends JournalQuery {
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => FinalInput) grades: FinalInput[];
}
