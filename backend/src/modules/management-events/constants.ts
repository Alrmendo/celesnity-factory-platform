// Seeded organization id (Step 9). The assessment PDF's Management Events
// section explicitly allows this: "Full authentication and user-management
// functionality is not required. Candidates may use a seeded organization
// and actor, but all management events must still include organizationId,
// actor, and timestamp." There is no multi-org selection anywhere in this
// app (no auth at all), so every management event uses this one fixed
// value. Shared here — not a local literal duplicated in prisma/seed.ts and
// ManagementEventsService — so the two places that need it can never
// silently drift apart. prisma/seed.ts previously declared its own local
// `SEED_ORGANIZATION_ID = 'org-seed'`; it now imports this instead.
export const SEED_ORGANIZATION_ID = 'org-seed';
