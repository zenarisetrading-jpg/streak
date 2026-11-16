// Test helpers: an in-memory D1 stand-in backed by node:sqlite, and Access JWTs.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';

export function memoryD1() {
 const db = new DatabaseSync(':memory:');
 for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) db.exec(readFileSync('drizzle/' + file, 'utf8'));
 const statement = (sql, params = []) => ({
  bind: (...values) => statement(sql, values),
  all: async () => ({results: db.prepare(sql).all(...params)}),
  first: async () => db.prepare(sql).get(...params) ?? null,
  run: async () => db.prepare(sql).run(...params),
 });
 return {prepare: sql => statement(sql), batch: async statements => Promise.all(statements.map(s => s.run())), raw: db};
}

const b64url = bytes => Buffer.from(bytes).toString('base64url');

export async function accessIssuer(teamDomain, aud) {
 const {privateKey, publicKey} = await crypto.subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']);
 const jwk = {...await crypto.subtle.exportKey('jwk', publicKey), kid: 'test-key', alg: 'RS256'};
 const sign = async (claims, {kid = 'test-key'} = {}) => {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({alg: 'RS256', kid}));
  const payload = b64url(JSON.stringify({iss: 'https://' + teamDomain, aud: [aud], iat: now, exp: now + 600, ...claims}));
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(header + '.' + payload));
  return header + '.' + payload + '.' + b64url(new Uint8Array(signature));
 };
 const certsUrl = 'https://' + teamDomain + '/cdn-cgi/access/certs';
 return {jwk, sign, certsUrl};
}

// A tiny valid JPEG header followed by filler bytes, base64-encoded.
export const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(7)]).toString('base64');
export const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, ...new Array(60).fill(7)]).toString('base64');
