import { readFileSync, writeFileSync } from 'node:fs';
import { verifyEvent } from 'nostr-tools/pure';

// Publish the same signed events on retries: no secret needed, no duplicate post.
const profile = JSON.parse(readFileSync(new URL('../docs/nostr/profile.json', import.meta.url), 'utf8'));
const events = JSON.parse(readFileSync(new URL('../docs/nostr/events.json', import.meta.url), 'utf8'));
if (!events.every(event => event.pubkey === profile.pubkey && verifyEvent(event))) {
  throw new Error('Profile identity or event signature mismatch');
}

const results = await Promise.all(profile.relays.map(relay => new Promise(resolve => {
  const socket = new WebSocket(relay);
  const accepted = new Set();
  const retrieved = new Set();
  const errors = [];
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    socket.close();
    resolve({ relay, accepted: [...accepted], retrieved: [...retrieved], errors });
  };
  const timer = setTimeout(() => { errors.push('Timed out'); finish(); }, 20000);
  socket.addEventListener('open', () => {
    for (const event of events) socket.send(JSON.stringify(['EVENT', event]));
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data));
    if (message[0] === 'OK') {
      if (message[2]) accepted.add(message[1]);
      else errors.push(`${message[1]}: ${message[3]}`);
      if (accepted.size === events.length) {
        socket.send(JSON.stringify(['REQ', 'verify-ossr', { ids: events.map(event => event.id) }]));
      }
    }
    if (message[0] === 'EVENT' && message[1] === 'verify-ossr' && verifyEvent(message[2]) && events.some(event => event.id === message[2].id)) {
      retrieved.add(message[2].id);
    }
    if (message[0] === 'EOSE' && message[1] === 'verify-ossr') finish();
    if (message[0] === 'NOTICE') errors.push(message[1]);
  });
  socket.addEventListener('error', () => { errors.push('WebSocket connection failed'); finish(); });
  socket.addEventListener('close', finish);
})));

const report = { checkedAt: new Date().toISOString(), results };
writeFileSync(new URL('../docs/nostr/publication.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!results.some(result => result.retrieved.length === events.length)) process.exitCode = 1;
