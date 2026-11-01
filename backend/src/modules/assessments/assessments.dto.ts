import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { AssessmentType } from '@prisma/client';
import { IsDateStr } from '../../common/dto/validators';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AssessmentListQuery {
  @IsOptional() @IsEnum(AssessmentType) type?: AssessmentType;
  @IsOptional() @Type(() => Number) @IsInt() classId?: number;
  @IsOptional() @Type(() => Number) @IsInt() subjectId?: number;
  @IsOptional() @Type(() => Number) @IsInt() quarterId?: number;
  /** Топ таңдалса: осы топтың және бүкіл сыныптың бағалаулары. */
  @IsOptional() @Type(() => Number) @IsInt() groupId?: number;
}

export class CriterionInput {
  @IsOptional() @Type(() => Number) @IsInt() id?: number;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(10) code: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) topic: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.5) @Max(100) maxScore: number;
}

export class AssessmentInput {
  @IsEnum(AssessmentType) type: AssessmentType;
  @Type(() => Number) @IsInt() classId: number;
  @Type(() => Number) @IsInt() subjectId: number;
  @Type(() => Number) @IsInt() quarterId: number;
  @IsOptional() @Type(() => Number) @IsInt() groupId?: number | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) section?: string | null;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(160) title: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(200) maxScore: number;
  @IsOptional() @IsDateStr() date?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => CriterionInput) criteria?: CriterionInput[];
}

export class CriterionScore {
  @Type(() => Number) @IsInt() criterionId: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) score: number;
}

export class ResultInput {
  @Type(() => Number) @IsInt() studentId: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) score?: number | null;
  @IsOptional() @IsBoolean() absent?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CriterionScore) criteria?: CriterionScore[];
}

export class SaveResultsInput {
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ResultInput) results: ResultInput[];
}

export class AnalysisExportQuery {
  @IsOptional() @IsIn(['csv', 'xlsx']) format: 'csv' | 'xlsx' = 'xlsx';
}
