import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { AttendanceStatus } from '@prisma/client';
import { IsDateStr } from '../../common/dto/validators';

export class SheetQuery {
  @Type(() => Number) @IsInt() classId: number;
  @Type(() => Number) @IsInt() subjectId: number;
  @IsDateStr() date: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(10) period: number;
}

export class MarkInput {
  @Type(() => Number) @IsInt() studentId: number;
  @IsEnum(AttendanceStatus) status: AttendanceStatus;
  @IsOptional() @Type(() => Number) @IsInt() reasonId?: number | null;
  @IsOptional() @IsString() @MaxLength(300) note?: string | null;
}

export class SaveSheetInput extends SheetQuery {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => MarkInput)
  marks: MarkInput[];
}

export class CalendarQuery {
  @Type(() => Number) @IsInt() classId: number;
  @Matches(/^\d{4}-\d{2}$/) month: string;
  @IsOptional() @Type(() => Number) @IsInt() subjectId?: number;
}

export class DayQuery {
  @IsOptional() @IsDateStr() date?: string;
}
