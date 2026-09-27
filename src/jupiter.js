import { Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { json } from './http.js';
import { NATIVE } from './market.js';

const BASE = 'https://api.jup.ag/swap/v2';
const amount = v => { const n = BigInt(v); if (n <= 0n) throw new Error('Nonpositive quote amount'); return n; };

export class Jupiter {
  constructor(apiKey, secret) {
    this.apiKey = apiKey;
    // Paper mode never reads or constructs a wallet signer.
    this.signer = secret ? Keypair.fromSecretKey(bs58.decode(secret)) : null;
  }
  async order(inputMint, outputMint, rawAmount, live = false) {
    const params = new URLSearchParams({ inputMint, outputMint, amount: amount(rawAmount).toString() });
    if (live) {
      if (!this.signer) throw new Error('Missing live wallet');
      params.set('taker', this.signer.publicKey.toBase58());
    }
    const o = await json(`${BASE}/order?${params}`, { headers: { 'x-api-key': this.apiKey } });
    if (o.error || !o.outAmount || BigInt(o.outAmount) <= 0n || (live && !o.transaction)) throw new Error(`No executable Jupiter route: ${o.errorMessage || o.error || 'no output/transaction'}`);
    return o;
  }
  async roundtrip(mint, solAmount) {
    const buy = await this.order(NATIVE, mint, Math.round(solAmount * 1e9));
    const sell = await this.order(mint, NATIVE, buy.outAmount);
    return { buy, sell, costPct: (1 - Number(sell.outAmount) / (solAmount * 1e9)) * 100 };
  }
  async execute(order) {
    if (!this.signer || !order.transaction || !order.requestId) throw new Error('Unsigned or incomplete live order');
    const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, 'base64'));
    tx.sign([this.signer]);
    // A failed HTTP response is ambiguous; never automatically resubmit a new order.
    const result = await json(`${BASE}/execute`, { method: 'POST', headers: {
      'x-api-key': this.apiKey, 'content-type': 'application/json' }, body: JSON.stringify({
      signedTransaction: Buffer.from(tx.serialize()).toString('base64'), requestId: order.requestId,
    }) });
    if (result.status !== 'Success' || result.code !== 0 || !result.signature || !result.totalOutputAmount) throw new Error(`Execution status uncertain/failed: ${JSON.stringify(result).slice(0, 250)}`);
    return result;
  }
}
