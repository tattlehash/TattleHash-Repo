/**
 * Proof of Funds (POF) Handlers
 *
 * SECURITY NOTE: These endpoints are currently DISABLED (501 Not Implemented)
 * because the signature verification and balance checking are stub implementations.
 *
 * Before enabling:
 * 1. Implement real EIP-191 signature verification in verifyAddressOwnership()
 * 2. Implement real RPC balance fetching via Alchemy/Infura in getBalanceInUSD()
 * 3. Add proper authentication
 * 4. Add rate limiting specific to POF operations
 */

import { Env } from '../types';

/**
 * Returns 501 Not Implemented response for disabled POF endpoints.
 */
function notImplementedResponse(): Response {
    return new Response(
        JSON.stringify({
            ok: false,
            error: {
                code: 'NOT_IMPLEMENTED',
                message: 'Proof of Funds coming soon',
            },
        }),
        {
            status: 501,
            headers: { 'Content-Type': 'application/json' },
        }
    );
}

/**
 * POST /pof/init - Initialize a Proof of Funds verification
 *
 * DISABLED: Returns 501 Not Implemented
 * This endpoint will be enabled once real signature verification is implemented.
 */
export async function postPofInit(_req: Request, _env: Env): Promise<Response> {
    return notImplementedResponse();
}

/**
 * POST /pof/post - Submit Proof of Funds verification
 *
 * DISABLED: Returns 501 Not Implemented
 * This endpoint will be enabled once real balance checking is implemented.
 */
export async function postPofPost(_req: Request, _env: Env): Promise<Response> {
    return notImplementedResponse();
}
