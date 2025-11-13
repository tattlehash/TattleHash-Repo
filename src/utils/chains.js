// utils/chains.js — Chain registry + minimal EVM RPC helpers for ETH & Base

export const CHAIN_REGISTRY = {
  chains: {
    1:    { alias: 'ethereum', rpcEnv: 'RPC_ETH_MAIN',  decimals: 18, type: 'evm' },
    8453: { alias: 'base',     rpcEnv: 'RPC_BASE_MAIN', decimals: 18, type: 'evm' }
  },
  assets: {} // add ERC-20/NFT metadata later
};

export function toUnits(amountStr, decimals = 18n) {
  const [i = '0', f = ''] = amountStr.split('.');
  const pad = BigInt(decimals) - BigInt(f.length);
  const frac = BigInt(f || '0') * 10n ** pad;
  return BigInt(i) * 10n ** BigInt(decimals) + frac;
}

export async function evmRpc(env, rpcEnvName, method, params) {
  const url = env[rpcEnvName];
  if (!url) throw new Error(`Missing env ${rpcEnvName}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const j = await res.json();
  if (j.error) throw new Error(`RPC error: ${JSON.stringify(j.error)}`);
  return j.result;
}

export async function getNativeBalance(env, chainId, address) {
  const chain = CHAIN_REGISTRY.chains[chainId];
  if (!chain) throw new Error(`Unsupported chainId ${chainId}`);
  const hex = await evmRpc(env, chain.rpcEnv, 'eth_getBalance', [address, 'latest']);
  return BigInt(hex);
}

export function meetsThreshold(balanceWei, minAmountStr, decimals = 18n) {
  const threshold = toUnits(minAmountStr, decimals);
  return balanceWei >= threshold;
}

// ------------------------------
// Pretty-print helpers
// ------------------------------

/**
 * Convert wei to human-readable ETH string with up to 6 decimals.
 * Example: 18248200000000000 -> "0.0182482"
 */
export function prettyEth(balanceWei) {
  try {
    const wei = BigInt(balanceWei);
    const eth = Number(wei) / 1e18;
    return eth.toFixed(6).replace(/\.?0+$/, ''); // trim trailing zeros
  } catch {
    return '0';
  }
}
