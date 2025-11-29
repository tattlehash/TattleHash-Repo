
interface JsonRpcRequest {
    jsonrpc: '2.0';
    method: string;
    params: unknown[];
    id: number;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    result?: string;
    error?: { code: number; message: string };
    id: number;
}

let requestId = 1;

export async function rpcCall(
    endpoint: string,
    method: string,
    params: unknown[]
): Promise<string> {
    const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method,
        params,
        id: requestId++,
    };

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });

    if (!response.ok) {
        throw new Error(`RPC request failed: ${response.status}`);
    }

    const data: JsonRpcResponse = await response.json();

    if (data.error) {
        throw new Error(`RPC error: ${data.error.message}`);
    }

    return data.result!;
}

export async function getNativeBalance(
    endpoint: string,
    address: string
): Promise<bigint> {
    const result = await rpcCall(endpoint, 'eth_getBalance', [address, 'latest']);
    return BigInt(result);
}

export async function getErc20Balance(
    endpoint: string,
    tokenAddress: string,
    walletAddress: string
): Promise<bigint> {
    // ERC-20 balanceOf(address) selector: 0x70a08231
    const data = '0x70a08231' + walletAddress.slice(2).padStart(64, '0');

    const result = await rpcCall(endpoint, 'eth_call', [
        { to: tokenAddress, data },
        'latest',
    ]);

    return BigInt(result);
}
