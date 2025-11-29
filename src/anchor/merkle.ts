/**
 * Merkle tree implementation for batching attestations.
 *
 * Attestations are hashed and combined into a Merkle tree.
 * Only the root hash is submitted to the blockchain, enabling
 * efficient verification of individual attestations.
 */

/**
 * SHA-256 hash of input data.
 */
async function sha256(data: Uint8Array): Promise<Uint8Array> {
    // Use slice to ensure we have a standard ArrayBuffer (not SharedArrayBuffer)
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return new Uint8Array(hashBuffer);
}

/**
 * Convert hex string to Uint8Array.
 */
function hexToBytes(hex: string): Uint8Array {
    const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
    }
    return bytes;
}

/**
 * Convert Uint8Array to hex string.
 */
function bytesToHex(bytes: Uint8Array): string {
    return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash two nodes together to create parent node.
 * Nodes are sorted before hashing for deterministic ordering.
 */
async function hashPair(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
    // Sort nodes for consistent ordering regardless of input order
    const [first, second] = compareBytes(left, right) <= 0
        ? [left, right]
        : [right, left];

    const combined = new Uint8Array(first.length + second.length);
    combined.set(first, 0);
    combined.set(second, first.length);

    return sha256(combined);
}

/**
 * Compare two byte arrays lexicographically.
 */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        if (a[i] !== b[i]) {
            return a[i] - b[i];
        }
    }
    return a.length - b.length;
}

/**
 * Merkle proof for a single leaf.
 */
export interface MerkleProof {
    leaf: string;      // The leaf hash (hex)
    root: string;      // The root hash (hex)
    proof: string[];   // Sibling hashes from leaf to root (hex)
    index: number;     // Position of leaf in tree
}

/**
 * Merkle tree result.
 */
export interface MerkleTree {
    root: string;           // Root hash (hex)
    leaves: string[];       // Original leaf hashes (hex)
    proofs: MerkleProof[];  // Proofs for each leaf
}

/**
 * Build a Merkle tree from a list of data items.
 *
 * @param items - Data items to include (will be hashed)
 * @returns Merkle tree with root and proofs
 */
export async function buildMerkleTree(items: string[]): Promise<MerkleTree> {
    if (items.length === 0) {
        throw new Error('Cannot build Merkle tree with no items');
    }

    // Hash each item to create leaves
    const encoder = new TextEncoder();
    const leaves: Uint8Array[] = await Promise.all(
        items.map(item => sha256(encoder.encode(item)))
    );

    const leafHexes = leaves.map(bytesToHex);

    // Special case: single leaf
    if (leaves.length === 1) {
        return {
            root: leafHexes[0],
            leaves: leafHexes,
            proofs: [{
                leaf: leafHexes[0],
                root: leafHexes[0],
                proof: [],
                index: 0,
            }],
        };
    }

    // Build tree level by level, storing sibling relationships
    const tree: Uint8Array[][] = [leaves];
    const siblingIndices: number[][] = [];

    let currentLevel = leaves;
    while (currentLevel.length > 1) {
        const nextLevel: Uint8Array[] = [];
        const siblings: number[] = [];

        for (let i = 0; i < currentLevel.length; i += 2) {
            const left = currentLevel[i];
            const right = currentLevel[i + 1] || left; // Duplicate last if odd

            const parent = await hashPair(left, right);
            nextLevel.push(parent);

            // Record sibling index for proof generation
            if (i + 1 < currentLevel.length) {
                siblings.push(i + 1); // Right sibling for left node
                siblings.push(i);     // Left sibling for right node
            } else {
                siblings.push(i); // Self-sibling for odd node
            }
        }

        tree.push(nextLevel);
        siblingIndices.push(siblings);
        currentLevel = nextLevel;
    }

    const root = bytesToHex(currentLevel[0]);

    // Generate proofs for each leaf
    const proofs: MerkleProof[] = leaves.map((leaf, leafIndex) => {
        const proof: string[] = [];
        let currentIndex = leafIndex;

        for (let level = 0; level < tree.length - 1; level++) {
            const siblingIndex = currentIndex % 2 === 0
                ? currentIndex + 1
                : currentIndex - 1;

            // Handle odd-length levels
            if (siblingIndex < tree[level].length) {
                proof.push(bytesToHex(tree[level][siblingIndex]));
            } else {
                proof.push(bytesToHex(tree[level][currentIndex]));
            }

            currentIndex = Math.floor(currentIndex / 2);
        }

        return {
            leaf: leafHexes[leafIndex],
            root,
            proof,
            index: leafIndex,
        };
    });

    return {
        root,
        leaves: leafHexes,
        proofs,
    };
}

/**
 * Verify a Merkle proof.
 *
 * @param proof - The Merkle proof to verify
 * @returns true if proof is valid
 */
export async function verifyMerkleProof(proof: MerkleProof): Promise<boolean> {
    let current = hexToBytes(proof.leaf);
    let index = proof.index;

    for (const siblingHex of proof.proof) {
        const sibling = hexToBytes(siblingHex);
        current = await hashPair(current, sibling);
        index = Math.floor(index / 2);
    }

    return bytesToHex(current) === proof.root;
}

/**
 * Create a leaf hash from attestation data.
 * Used to create consistent leaves for the Merkle tree.
 */
export function createLeafData(
    receiptId: string,
    initiatorCommit: string,
    counterCommit?: string,
    timestamp?: number
): string {
    const parts = [
        receiptId,
        initiatorCommit,
        counterCommit || '',
        (timestamp || Date.now()).toString(),
    ];
    return parts.join(':');
}
