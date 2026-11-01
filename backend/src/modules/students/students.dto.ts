import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Matches, MaxLength, MinLength, IsIn } from 'class-validator';
import { Gender, StudentStatus } from '@prisma/client';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { IsDateStr } from '../../common/dto/validators';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? null : typeof value === 'string' ? value.trim() : value);
const PHONE = /^\+?[0-9 ()-]{7,20}$/;

export class StudentListQuery extends PaginationQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() classId?: number;
  @ApiPropertyOptional({ enum: Gender }) @IsOptional() @IsEnum(Gender) gender?: Gender;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() nationalityId?: number;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'LEFT', 'EXPELLED', 'ALL'] }) @IsOptional() @IsIn(['ACTIVE', 'LEFT', 'EXPELLED', 'ALL']) status?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() schoolYearId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() quarterId?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateStr() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateStr() to?: string;
}

export class StudentExportQuery extends StudentListQuery {
  @IsOptional() @IsIn(['csv', 'xlsx']) format: 'csv' | 'xlsx' = 'csv';
}

export class StudentInput {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(60) lastName: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(60) firstName: string;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(60) middleName?: string | null;
  @IsEnum(Gender) gender: Gender;
  @IsDateStr() birthDate: string;
  @IsOptional() @Type(() => Number) @IsInt() nationalityId?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() classId?: number | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @Length(12, 12, { message: 'ЖСН 12 саннан тұрады' }) @Matches(/^\d{12}$/, { message: 'ЖСН тек сандардан тұрады' }) iin?: string | null;
  @IsOptional() @Transform(emptyToNull) @Matches(PHONE, { message: 'Телефон форматы қате' }) phone?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(120) parentName?: string | null;
  @IsOptional() @Transform(emptyToNull) @Matches(PHONE, { message: 'Телефон форматы қате' }) parentPhone?: string | null;
  @IsOptional() @IsDateStr() enrolledAt?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(160) previousSchool?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(2000) notes?: string | null;
}

export class StudentUpdate extends StudentInput {
  @IsOptional() @IsEnum(StudentStatus) status?: StudentStatus;
}

export class MonthQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) month?: string;
}

export class StudentImportInput {
  /** .xlsx файлының base64 мазмұны */
  @IsString() @MaxLength(6_000_000) data: string;
  @IsOptional() @IsBoolean() apply?: boolean;
}
