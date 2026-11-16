import assets, {version} from './assets.mjs';
import {identify} from './auth.mjs';
import {listRecords, writeRecords} from './records.mjs';
import {analyzeMeal} from './meal-photo.mjs';
import {analyzeWorkout} from './workout.mjs';
import {ingestHealth, tokenStatus, createToken, revokeToken} from './health.mjs';
import {listPeople, invitePerson, removePerson} from './people.mjs';

// Reachable without Cloudflare Access sign-in: the Health ingest (it checks a per-person key), and the
// app icons and manifest, which phones fetch without cookies when saving the home-screen shortcut.
// Each of these paths also has an Access bypass app; see SETUP.md.
const INGEST_PATH = '/ingest/health';
const PUBLIC_ASSETS = {'/icon.png': '/icon.png', '/apple-touch-icon.png': '/icon.png', '/apple-touch-icon-precomposed.png': '/icon.png', '/icon-192.png': '/icon-192.png', '/icon-512.png': '/icon-512.png', '/favicon.png': '/favicon.png', '/app.webmanifest': '/app.webmanifest'};
const PUBLIC_CACHE = 'public, max-age=86400';

const BASE_HEADERS = {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-App-Version': version};

function serveAsset(pathname, cache = BASE_HEADERS['Cache-Control']) {
 const [type, body] = assets[pathname];
 const content = type.startsWith('image/') ? Uint8Array.from(atob(body), c => c.charCodeAt(0)) : body;
 return new Response(content, {headers: {...BASE_HEADERS, 'Content-Type': type, 'Cache-Control': cache}});
}

export default {
 async fetch(request, env) {
  const {pathname, origin} = new URL(request.url);
  const headers = BASE_HEADERS;
  if (pathname === INGEST_PATH) {
   try { return await ingestHealth(request, env, headers); }
   catch (error) { console.error('Health ingest failed:', error); return Response.json({error: 'Server error'}, {status: 500, headers}); }
  }
  if (request.method === 'GET' && Object.hasOwn(PUBLIC_ASSETS, pathname)) return serveAsset(PUBLIC_ASSETS[pathname], PUBLIC_CACHE);
  const who = await identify(request, env);
  if (who.error) return new Response(who.error, {status: who.status, headers});
  if (request.method === 'GET' && Object.hasOwn(assets, pathname)) return serveAsset(pathname);

  const sameOrigin = request.headers.get('origin') === origin;
  try {
   if (pathname === '/api/me' && request.method === 'GET') return Response.json({email: who.email}, {headers});
   if (pathname === '/api/records') {
    if (request.method === 'GET') return await listRecords(request, env, who.email, headers);
    if (request.method === 'POST' && sameOrigin) return await writeRecords(request, env, who.email, headers);
    return new Response('Forbidden', {status: 403, headers});
   }
   if (pathname === '/api/health-key') {
    if (request.method === 'GET') return await tokenStatus(env, who.email, headers);
    if (request.method === 'POST' && sameOrigin) return await createToken(env, who.email, headers);
    if (request.method === 'DELETE' && sameOrigin) return await revokeToken(env, who.email, headers);
    return new Response('Forbidden', {status: 403, headers});
   }
   if (pathname === '/api/people') {
    if (request.method === 'GET') return await listPeople(env, who.email, headers);
    if (request.method === 'POST' && sameOrigin) return await invitePerson(request, env, who.email, headers);
    if (request.method === 'DELETE' && sameOrigin) return await removePerson(request, env, who.email, headers);
    return new Response('Forbidden', {status: 403, headers});
   }
   if (pathname === '/api/meal-photo' || pathname === '/api/meal-estimate') {
    if (request.method === 'POST' && sameOrigin) return await analyzeMeal(request, env, who.email, headers);
    return new Response('Forbidden', {status: 403, headers});
   }
   if (pathname === '/api/workout-estimate') {
    if (request.method === 'POST' && sameOrigin) return await analyzeWorkout(request, env, who.email, headers);
    return new Response('Forbidden', {status: 403, headers});
   }
  } catch (error) {
   console.error('Request failed:', pathname, error);
   return new Response('Server error', {status: 500, headers});
  }
  return new Response('Not found', {status: 404, headers});
 }
};
