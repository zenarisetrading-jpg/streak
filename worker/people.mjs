// Who may use the app. Household emails (ALLOWED_EMAILS) always may; the owner (OWNER_EMAIL) can invite
// more people from Settings. Invites live in D1, and every change rewrites the email list on the
// Cloudflare Access sign-in rule using a token that can only edit Access apps and policies.
const API = 'https://api.cloudflare.com/client/v4';
const MAX_GUESTS = 10;
const MAX_EMAIL_LENGTH = 254;
const EMAIL = /^(?=[^@]{1,64}@)[a-z0-9_+-]+(\.[a-z0-9_+-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const API_TIMEOUT_MS = 10000;
// Fields Cloudflare returns but does not accept back on a policy update.
const READ_ONLY = ['id', 'uid', 'created_at', 'updated_at', 'version', 'app_count', 'reusable'];
const ACCESS_SETTINGS = ['ACCESS_ADMIN_TOKEN', 'CF_ACCOUNT_ID', 'ACCESS_APP_ID', 'ACCESS_POLICY_ID'];

const clean = value => String(value || '').trim().toLowerCase();
const householdEmails = env => [...new Set(String(env.ALLOWED_EMAILS || '').split(',').map(clean).filter(Boolean))];
const isOwner = (env, email) => Boolean(email) && clean(env.OWNER_EMAIL) === email;
const validEmail = email => email.length <= MAX_EMAIL_LENGTH && EMAIL.test(email);

async function guests(env) {
 const {results} = await env.DB.prepare('SELECT email, added_at FROM people ORDER BY added_at, email').all();
 return results;
}

// Allowed when there is no household list (Access alone decides), or the email is the owner's,
// on the household list, or invited.
export async function isAllowed(env, email) {
 const household = householdEmails(env);
 if (!household.length || household.includes(email) || isOwner(env, email)) return true;
 return Boolean(await env.DB.prepare('SELECT 1 FROM people WHERE email = ?').bind(email).first());
}

async function cloudflare(env, method, body) {
 const url = `${API}/accounts/${env.CF_ACCOUNT_ID}/access/apps/${env.ACCESS_APP_ID}/policies/${env.ACCESS_POLICY_ID}`;
 const response = await fetch(url, {method, headers: {Authorization: 'Bearer ' + env.ACCESS_ADMIN_TOKEN, 'Content-Type': 'application/json'}, body: body && JSON.stringify(body), signal: AbortSignal.timeout(API_TIMEOUT_MS)});
 const data = await response.json().catch(() => ({}));
 if (!response.ok || !data.success) throw new Error(`Cloudflare ${method} policy failed (${response.status}): ${JSON.stringify(data.errors || []).slice(0, 300)}`);
 return data.result;
}

const allowedList = async env => [...new Set([clean(env.OWNER_EMAIL), ...householdEmails(env), ...(await guests(env)).map(g => g.email)].filter(Boolean))];

// Rewrites the sign-in rule's email list to owner + household + invited people, keeping every other
// setting and rule on the policy. Writes again if the list changed meanwhile (two changes at once).
async function syncAccess(env) {
 for (let attempt = 0; attempt < 2; attempt++) {
  const policy = await cloudflare(env, 'GET');
  const emails = await allowedList(env);
  if (!emails.length) throw new Error('Refusing to write a sign-in rule with no emails');
  const rest = Object.fromEntries(Object.entries(policy).filter(([key]) => !READ_ONLY.includes(key)));
  await cloudflare(env, 'PUT', {...rest, include: [...(policy.include || []).filter(rule => !rule.email), ...emails.map(email => ({email: {email}}))]});
  if ((await allowedList(env)).join() === emails.join()) return;
 }
}

const configured = env => ACCESS_SETTINGS.every(name => env[name]);
const changed = result => Boolean((result.meta ?? result).changes);
const reply = (headers, body, status = 200) => Response.json(body, {status, headers});

export async function listPeople(env, owner, headers) {
 if (!isOwner(env, owner)) return reply(headers, {error: 'Only the owner can manage people.'}, 403);
 return reply(headers, {household: householdEmails(env), invited: await guests(env), max: MAX_GUESTS, ready: configured(env)});
}

async function readEmail(request) {
 const body = await request.json().catch(() => ({}));
 return clean(body?.email);
}

export async function invitePerson(request, env, owner, headers) {
 if (!isOwner(env, owner)) return reply(headers, {error: 'Only the owner can invite people.'}, 403);
 if (!configured(env)) return reply(headers, {error: 'Inviting is not set up on the server yet.'}, 503);
 const email = await readEmail(request);
 if (!validEmail(email)) return reply(headers, {error: 'Enter a valid email address.'}, 400);
 if (householdEmails(env).includes(email)) return reply(headers, {error: 'That person already has access.'}, 409);
 const current = await guests(env);
 if (current.some(g => g.email === email)) return reply(headers, {error: 'That person is already invited.'}, 409);
 if (current.length >= MAX_GUESTS) return reply(headers, {error: `You can invite up to ${MAX_GUESTS} people.`}, 409);

 const inserted = await env.DB.prepare('INSERT INTO people (email, added_by, added_at) VALUES (?, ?, ?) ON CONFLICT (email) DO NOTHING').bind(email, owner, new Date().toISOString()).run();
 if (!changed(inserted)) return reply(headers, {error: 'That person is already invited.'}, 409);
 try { await syncAccess(env); }
 catch (error) {
  console.error('Invite: Access update failed:', error.message);
  await env.DB.prepare('DELETE FROM people WHERE email = ?').bind(email).run();
  return reply(headers, {error: 'Could not update the sign-in list. Nothing was changed.'}, 502);
 }
 console.log(JSON.stringify({event: 'person_invited', by: owner}));
 return reply(headers, {email}, 201);
}

// Removing takes effect in the app at once (the database check), even if the Access update fails.
export async function removePerson(request, env, owner, headers) {
 if (!isOwner(env, owner)) return reply(headers, {error: 'Only the owner can remove people.'}, 403);
 if (!configured(env)) return reply(headers, {error: 'Inviting is not set up on the server yet.'}, 503);
 const email = await readEmail(request);
 const result = await env.DB.prepare('DELETE FROM people WHERE email = ?').bind(email).run();
 if (!changed(result)) return reply(headers, {error: 'That person is not on the invited list.'}, 404);
 // Their Apple Health key skips sign-in, so it has to go too.
 await env.DB.prepare('DELETE FROM health_tokens WHERE user_id = ?').bind(email).run();
 console.log(JSON.stringify({event: 'person_removed', by: owner}));
 try { await syncAccess(env); }
 catch (error) {
  console.error('Remove: Access update failed:', error.message);
  return reply(headers, {email, warning: 'Removed from the app. The sign-in list will catch up on your next change.'});
 }
 return reply(headers, {email});
}
