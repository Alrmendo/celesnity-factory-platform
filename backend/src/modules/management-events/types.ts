// Request shapes for the 4 management actions (Step 9). No REST contract
// exists for this anywhere in docs/plan-v4.md or the assessment PDF — the
// PDF's "Management Events" section lists only the 4 required actions
// (Acknowledge an exception, Block a batch, Resume a batch, Add a note),
// not routes or a request body shape. The routes below (POST
// /management-events/block|resume|ack-exception|note) and these DTOs are
// this repo's own design — documented as an assumption in README.md's
// "Assessment Assumptions" section, per the task instructions for when the
// requirements leave something open.
//
// `actor` is required from the caller on every action (not a second seeded
// constant like organizationId): unlike "which organization", there IS no
// single fixed answer for "which manager did this" even without real
// auth — the assessment's own example ("Candidates may use a seeded
// organization and actor") is presented as an option, not a mandate, and a
// free-text actor per call is what makes multiple managers' actions
// distinguishable in the append-only audit log at all. `timestamp` is
// NEVER accepted from the request body — see
// ManagementEventsService.create, which always stamps `new Date()`
// server-side, so a caller can't backdate/forge history.
export interface ManagementActionDto {
  batchId: string;
  actor: string;
  note?: string;
}

export interface AddNoteDto {
  batchId: string;
  actor: string;
  note: string;
}
