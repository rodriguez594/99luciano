// Everything under /api/admin needs a valid Cloudflare Access login (see lib/access.js).
import { adminEmail } from '../../../lib/access.js';
import { HttpError, json } from '../../../lib/db.js';

export async function onRequest(context) {
  try {
    context.data.email = await adminEmail(context.request, context.env);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    throw e;
  }
  return context.next();
}
