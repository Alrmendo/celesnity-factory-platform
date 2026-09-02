import { Controller, Get, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get()
  async check() {
    let db = false;
    try {
      await this.pool.query('SELECT 1');
      db = true;
    } catch {
      db = false;
    }
    return { status: 'ok', db };
  }
}
