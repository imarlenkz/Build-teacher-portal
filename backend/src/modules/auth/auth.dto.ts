import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'teacher' })
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  login: string;

  @ApiProperty({ example: 'Ustaz2026!' })
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password: string;
}

export class ChangePasswordDto {
  @IsString() @MaxLength(128) currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-zА-Яа-яӘәҒғҚқҢңӨөҰұҮүҺһІі])(?=.*\d).+$/, { message: 'Құпиясөзде әріп пен сан болуы керек' })
  newPassword: string;
}
