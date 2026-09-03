import { SourceType } from '@prisma/client';

export interface CreateSourceDto {
  name: string;
  type: SourceType;
  config: Record<string, unknown>;
}

export interface SourceResponse {
  id: string;
  name: string;
  type: SourceType;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
}
