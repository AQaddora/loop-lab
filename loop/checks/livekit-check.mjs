// Validates LiveKit Cloud creds from an env file: mints an HS256 JWT with roomList grant, calls RoomService.ListRooms.
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
const env = Object.fromEntries(readFileSync(process.argv[2], 'utf8').split('\n')
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const head = b64({ alg: 'HS256', typ: 'JWT' });
const body = b64({ iss: env.LIVEKIT_API_KEY, sub: 'loop-lab-check', nbf: now - 10, exp: now + 120, video: { roomList: true } });
const sig = createHmac('sha256', env.LIVEKIT_API_SECRET).update(`${head}.${body}`).digest('base64url');
const host = env.LIVEKIT_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
const r = await fetch(`${host}/twirp/livekit.RoomService/ListRooms`, {
  method: 'POST', headers: { Authorization: `Bearer ${head}.${body}.${sig}`, 'Content-Type': 'application/json' }, body: '{}' });
const txt = await r.text();
let rooms = '?'; try { rooms = (JSON.parse(txt).rooms || []).length; } catch {}
console.log(`host=${new URL(host).host} status=${r.status} ok=${r.ok} rooms=${rooms}${r.ok ? '' : ' body=' + txt.slice(0, 160)}`);
