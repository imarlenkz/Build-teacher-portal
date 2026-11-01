import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { IdpService } from './idp.service';

@Module({
  imports: [JwtModule.register({ global: true })],
  providers: [AuthService, IdpService],
  exports: [IdpService],
  controllers: [AuthController],
})
export class AuthModule {}
