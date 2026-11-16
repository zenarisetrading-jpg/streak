// Identity comes from Cloudflare Access. Access sits in front of the Worker and
// signs every request with a JWT; we verify it here instead of trusting headers.
import {isAllowed} from './people.mjs';
const CERT_TTL_MS = 60 * 60 * 1000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
let certCache = {url: '', keys: [], fetchedAt: 0};

const b64urlToBytes = value => {
 const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
 return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
};
const decodeJson = part => JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));

async function signingKeys(teamUrl, forceRefresh = false) {
 const url = teamUrl + '/cdn-cgi/access/certs';
 const fresh = certCache.url === url && Date.now() - certCache.fetchedAt < CERT_TTL_MS;
 if (fresh && !forceRefresh) return certCache.keys;
 const response = await fetch(url);
 if (!response.ok) throw new Error('Could not load Access signing keys: ' + response.status);
 const {keys} = await response.json();
 certCache = {url, keys: Array.isArray(keys) ? keys : [], fetchedAt: Date.now()};
 return certCache.keys;
}

async function verifySignature(token, teamUrl) {
 const [header, payload, signature] = token.split('.');
 const {kid, alg} = decodeJson(header);
 if (alg !== 'RS256') throw new Error('Unexpected JWT algorithm');
 let jwk = (await signingKeys(teamUrl)).find(key => key.kid === kid);
 if (!jwk) jwk = (await signingKeys(teamUrl, true)).find(key => key.kid === kid);
 if (!jwk) throw new Error('Unknown JWT key');
 const key = await crypto.subtle.importKey('jwk', jwk, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
 const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(signature), new TextEncoder().encode(header + '.' + payload));
 if (!valid) throw new Error('Bad JWT signature');
 return decodeJson(payload);
}

function teamUrlFrom(domain) {
 const host = String(domain || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
 return host ? 'https://' + host : '';
}

// Returns {email} for an allowed, verified user, or {error, status}.
export async function identify(request, env) {
 const {hostname} = new URL(request.url);
 if (env.DEV_USER_EMAIL && LOCAL_HOSTS.has(hostname)) return {email: String(env.DEV_USER_EMAIL).toLowerCase()};

 const teamUrl = teamUrlFrom(env.ACCESS_TEAM_DOMAIN);
 if (!teamUrl || !env.ACCESS_AUD) return {status: 500, error: 'Sign-in is not configured on the server.'};
 const token = request.headers.get('cf-access-jwt-assertion');
 if (!token) return {status: 401, error: 'Sign in required'};

 let claims;
 try { claims = await verifySignature(token, teamUrl); }
 catch (error) { console.error('Access JWT rejected:', error.message); return {status: 401, error: 'Sign in required'}; }

 const now = Math.floor(Date.now() / 1000);
 const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
 if (claims.iss !== teamUrl || !audiences.includes(env.ACCESS_AUD) || !(claims.exp > now) || (claims.nbf && claims.nbf > now + 60)) {
  return {status: 401, error: 'Sign in required'};
 }
 const raw = String(claims.email || '').trim();
 const email = raw.toLowerCase();
 // ASCII only, so case folding cannot turn a look-alike character into an invited address.
 if (!/^[\x21-\x7e]+$/.test(raw)) return {status: 403, error: 'This account is not allowed.'};
 try { if (!await isAllowed(env, email)) return {status: 403, error: 'This account is not allowed.'}; }
 catch (error) { console.error('People check failed:', error); return {status: 500, error: 'Server error'}; }
 return {email};
}
