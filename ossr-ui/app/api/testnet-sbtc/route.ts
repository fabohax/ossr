import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyMessageSignatureRsv } from '@stacks/encryption';
import { broadcastTransaction, getAddressFromPrivateKey, getAddressFromPublicKey, makeContractCall, noneCV, Pc, PostConditionMode, standardPrincipalCV, uintCV, validateStacksAddress } from '@stacks/transactions';

export const runtime = 'nodejs';
const amount = 10n;
const day = 86_400_000;
function config() {
  const key = process.env.SBTC_FAUCET_PRIVATE_KEY || process.env.SPONSOR_PRIVATE_KEY;
  if (!key) throw new Error('Testnet sBTC requests are unavailable: sponsor key is not configured.');
  return { key, sponsor: getAddressFromPrivateKey(key, 'testnet'), directory: process.env.SBTC_FAUCET_DATA_DIR || join(process.cwd(), '.sbtc-faucet'), contract: process.env.SBTC_FAUCET_CONTRACT || 'SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token' };
}
function mac(value: string, key: string) { return createHmac('sha256', key).update(value).digest('hex'); }
export async function POST(request: Request) {
  try {
    const { key, sponsor, directory, contract } = config();
    const body = await request.json();
    const address = body.address;
    if (typeof address !== 'string' || !/^ST/.test(address) || !validateStacksAddress(address) || address === sponsor) return Response.json({ error: 'Connect a Stacks testnet wallet.' }, { status: 400 });
    const site = new URL(request.url).origin;
    if (request.headers.get('origin') && request.headers.get('origin') !== site) return Response.json({ error: 'Invalid request origin.' }, { status: 403 });
    if (!body.challenge) {
      const message = `Request 10 satoshis of testnet sBTC from ${sponsor} to ${address}\nSite: ${site}\nExpires: ${Date.now() + 300_000}\nNonce: ${randomBytes(16).toString('hex')}`;
      return Response.json({ message, challenge: mac(message, key) });
    }
    const { message, challenge, signature, publicKey } = body;
    if ([message, challenge, signature, publicKey].some(value => typeof value !== 'string') || !/^[a-f0-9]{64}$/.test(challenge)) return Response.json({ error: 'Invalid signed request.' }, { status: 400 });
    const expected = mac(message, key);
    const expiry = Number(message.match(/\nExpires: (\d+)\nNonce: [a-f0-9]{32}$/)?.[1]);
    if (!timingSafeEqual(Buffer.from(challenge, 'hex'), Buffer.from(expected, 'hex')) || !message.startsWith(`Request 10 satoshis of testnet sBTC from ${sponsor} to ${address}\nSite: ${site}\nExpires: `) || !expiry || expiry < Date.now() || expiry > Date.now() + 300_000) return Response.json({ error: 'Request expired. Please sign a fresh request.' }, { status: 400 });
    if (getAddressFromPublicKey(publicKey, 'testnet') !== address || !verifyMessageSignatureRsv({ message, signature, publicKey })) return Response.json({ error: 'Signature does not match the connected wallet.' }, { status: 403 });
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const lock = join(directory, 'sponsor.lock');
    try { await writeFile(lock, '', { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; return Response.json({ error: 'Sponsor is processing another request. Try again shortly.' }, { status: 409 }); }
    try {
      const claimFile = join(directory, `${address}.json`);
      let previous: { at: number; txid: string; challenge: string } | undefined;
      try { previous = JSON.parse(await readFile(claimFile, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (previous && (previous.challenge === challenge || Date.now() - previous.at < day)) {
        if (previous.challenge === challenge) return Response.json({ txid: previous.txid, amountSats: '10' });
        return Response.json({ error: 'You can request 10 sats once every 24 hours.', txid: previous.txid }, { status: 429 });
      }
      const [contractAddress, contractName] = contract.split('.');
      if (!/^(SN|ST)/.test(contractAddress) || !validateStacksAddress(contractAddress) || !contractName) throw new Error('Invalid testnet faucet contract configuration.');
      const balanceResponse = await fetch(`https://api.testnet.hiro.so/extended/v1/address/${sponsor}/balances`, { cache: 'no-store' });
      if (!balanceResponse.ok) throw new Error('Sponsor balance lookup failed.');
      const balances = await balanceResponse.json();
      const available = balances.fungible_tokens?.[`${contract}::sbtc-token`]?.balance ?? '0';
      if (!/^\d+$/.test(available) || BigInt(available) < amount) return Response.json({ error: 'The sponsor needs more testnet sBTC to send 10 sats. Please try again after it is funded.' }, { status: 503 });
      const transaction = await makeContractCall({ network: 'testnet', senderKey: key, contractAddress, contractName, functionName: 'transfer', functionArgs: [uintCV(amount), standardPrincipalCV(sponsor), standardPrincipalCV(address), noneCV()], postConditionMode: PostConditionMode.Deny, postConditions: [Pc.principal(sponsor).willSendEq(amount).ft(`${contractAddress}.${contractName}`, 'sbtc-token')] });
      const txid = transaction.txid();
      // Persist before broadcasting: a lost response must never cause a second payment.
      await writeFile(claimFile, JSON.stringify({ at: Date.now(), txid, challenge }), { mode: 0o600 });
      let result;
      try { result = await broadcastTransaction({ transaction, network: 'testnet' }); }
      catch { return Response.json({ txid, amountSats: '10', status: 'broadcast_unknown' }, { status: 202 }); }
      if ('error' in result) {
        await unlink(claimFile);
        return Response.json({ error: 'Sponsor transfer was rejected by testnet.' }, { status: 502 });
      }
      return Response.json({ txid, amountSats: '10' });
    } finally { await unlink(lock); }
  } catch (error) {
    console.error('Testnet sBTC request failed', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'Testnet sBTC request could not be completed. Check the explorer before retrying.' }, { status: 503 });
  }
}
