import { Injectable } from '@nestjs/common';
import { resolveAll } from './canonicalization.pipeline';
import {
  deriveQualityIndicators,
  QualityIndicator,
} from './quality-indicators';
import { CanonicalizationResult, SourceRecordInput } from './types';

export interface CanonicalizeOutput {
  results: CanonicalizationResult[];
  qualityIndicators: QualityIndicator[];
}

// Thin wrapper over the pure pipeline (canonicalization.pipeline.ts +
// quality-indicators.ts) — takes records directly as a parameter, no Prisma
// query here. Wiring this to a real DB read/write is Step 4.
@Injectable()
export class CanonicalizationService {
  canonicalize(records: SourceRecordInput[]): CanonicalizeOutput {
    const results = resolveAll(records);
    const qualityIndicators = deriveQualityIndicators(results);
    return { results, qualityIndicators };
  }
}
