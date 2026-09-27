export async function json(url, opts = {}) {
  const response = await fetch(url, { ...opts, signal: AbortSignal.timeout(12000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`${new URL(url).host} HTTP ${response.status}: ${body.slice(0, 180)}`);
  try { return JSON.parse(body); } catch { throw new Error(`Invalid JSON from ${new URL(url).host}`); }
}

let rpcId = 0;
export async function rpc(url, method, params = []) {
  const result = await json(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  if (result.error) throw new Error(`RPC ${method}: ${JSON.stringify(result.error).slice(0, 200)}`);
  return result.result;
}
