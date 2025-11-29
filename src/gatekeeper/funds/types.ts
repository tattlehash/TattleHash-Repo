
export interface FundsCheckRequest {
    wallet_address: string;
    network: string;
    asset_type: 'NATIVE' | 'ERC20';
    min_balance: string; // wei/smallest unit as string
    token_address?: string; // required for ERC20
    challenge_id?: string;
    user_id?: string;
}

export interface FundsCheckResponse {
    status: 'PASSED' | 'FAILED';
    proof_type: 'OPAQUE_V1';
    provider: string;
    checked_at: number;
}

export interface ChainConfig {
    network: string;
    chainId: number;
    rpcEndpoints: string[];
    nativeCurrency: {
        symbol: string;
        decimals: number;
    };
    blockExplorer?: string;
}
