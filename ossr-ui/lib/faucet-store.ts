import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Redis } from '@upstash/redis';

export type FaucetClaim = { at: number; txid: string; challenge: string };
export interface FaucetStore {
  acquire(): Promise<boolean>;
  release(): Promise<void>;
  read(address: string): Promise<FaucetClaim | undefined>;
  save(address: string, claim: FaucetClaim): Promise<void>;
  remove(address: string): Promise<void>;
}
export function createFaucetStore(sponsor: string, directory: string): FaucetStore {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    const redis = new Redis({ url, token });
    const prefix = `ossr:faucet:${sponsor}`;
    const lock = `${prefix}:lock`;
    const owner = randomBytes(16).toString('hex');
    const claimKey = (address: string) => `${prefix}:claim:${address}`;
    return {
      // Lease outlasts the route's 60-second maximum lifetime.
      acquire: async () => await redis.set(lock, owner, { nx: true, ex: 120 }) === 'OK',
      release: async () => { await redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", [lock], [owner]); },
      read: async address => (await redis.get<FaucetClaim>(claimKey(address))) ?? undefined,
      save: async (address, claim) => {
        const saved = await redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[2], ARGV[2]); return 1 end return 0", [lock, claimKey(address)], [owner, JSON.stringify(claim)]);
        if (saved !== 1) throw new Error('Sponsor lock expired before payment was recorded.');
      },
      remove: async address => { await redis.del(claimKey(address)); },
    };
  }
  if (process.env.VERCEL) throw new Error('Persistent faucet storage is not configured.');
  const lock = join(directory, 'sponsor.lock');
  const claimFile = (address: string) => join(directory, `${address}.json`);
  return {
    acquire: async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      try { await writeFile(lock, '', { flag: 'wx', mode: 0o600 }); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; return false; }
    },
    release: async () => { await unlink(lock); },
    read: async address => {
      try { return JSON.parse(await readFile(claimFile(address), 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return undefined; }
    },
    save: async (address, claim) => { await writeFile(claimFile(address), JSON.stringify(claim), { mode: 0o600 }); },
    remove: async address => { await unlink(claimFile(address)); },
  };
}
