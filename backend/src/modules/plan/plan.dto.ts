import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { IsDateStr } from '../../common/dto/validators';
import { JournalQuery } from '../journal/journal.dto';
import { LIMITS } from './plan-import';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const nullIfEmpty = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

/** classId + subjectId + quarterId (+ groupId) — журналмен бірдей. */
export class PlanQuery extends JournalQuery {}

export class PlanExportQuery extends PlanQuery {
  @IsOptional() @IsIn(['xlsx', 'csv']) format: 'xlsx' | 'csv' = 'xlsx';
}

export class PlanLessonInput {
  @IsOptional() @Transform(nullIfEmpty) @IsString() @MaxLength(LIMITS.section) section?: string | null;
  @Transform(trim) @IsString() @MaxLength(LIMITS.topic) topic: string;
  @IsOptional() @Transform(nullIfEmpty) @IsString() @MaxLength(LIMITS.objectives) objectives?: string | null;
  @Type(() => Number) @IsInt() @Min(1) @Max(LIMITS.hours) hours: number = 1;
  @IsOptional() @Transform(nullIfEmpty) @IsDateStr() date?: string | null;
  @IsOptional() @Transform(nullIfEmpty) @IsString() @MaxLength(LIMITS.notes) notes?: string | null;
}

export class SavePlanInput extends PlanQuery {
  @IsArray() @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => PlanLessonInput) lessons: PlanLessonInput[];
}

export class PlanImportInput extends PlanQuery {
  /** .xlsx файлының base64 мазмұны */
  @IsString() @MaxLength(8_000_000) data: string;
  @IsOptional() @IsBoolean() apply?: boolean;
  /** Файлда «1-тоқсан» бөлгіштері болса — әр тоқсанға бөліп жазу (әдепкі true). Әйтпесе барлығы таңдалған тоқсанға. */
  @IsOptional() @IsBoolean() splitQuarters?: boolean;
}

export class PlanTarget {
  @Type(() => Number) @IsInt() classId: number;
  @IsOptional() @Type(() => Number) @IsInt() groupId?: number | null;
}

export class CopyPlanInput extends PlanQuery {
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => PlanTarget) targets: PlanTarget[];
  /** true — барлық тоқсанды көшіру, false — тек осы тоқсанды. */
  @IsOptional() @IsBoolean() allQuarters?: boolean;
  /** Жоспарланған күндерді де көшіру (сабақ кестесі бірдей болса). */
  @IsOptional() @IsBoolean() withDates?: boolean;
}

export class PlanToJournalInput extends PlanQuery {
  /** Тек бүгінге дейінгі сабақтар (әдепкі true). */
  @IsOptional() @IsBoolean() untilToday?: boolean;
}
