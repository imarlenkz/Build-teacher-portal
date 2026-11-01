import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PiiCipher } from '../../common/utils/crypto';

@Injectable()
export class PiiService extends PiiCipher {
  constructor(config: ConfigService) {
    super(config.getOrThrow('PII_ENCRYPTION_KEY'), config.getOrThrow('PII_HASH_KEY'));
  }
}
