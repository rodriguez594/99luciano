// GET /api/vault  What's in the vault right now (and when the next song opens).
import { getDb, json, handle } from '../../../lib/db.js';
import { publicVault } from '../../../lib/vault.js';

export const onRequestGet = handle(async ({ env }) => json(await publicVault(await getDb(env))));
