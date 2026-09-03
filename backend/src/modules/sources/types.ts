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
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Step 7: POST /sources/:id/select body.
export interface SelectTableDto {
  table: string;
}
