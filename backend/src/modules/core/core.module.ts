import { Global, Module } from '@nestjs/common';
import { ScopeService } from './scope.service';
import { LevelsService } from './levels.service';
import { PiiService } from './pii.service';

@Global()
@Module({ providers: [ScopeService, LevelsService, PiiService], exports: [ScopeService, LevelsService, PiiService] })
export class CoreModule {}
