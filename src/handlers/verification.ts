/**
 * Verification Portal HTTP Handlers
 *
 * Public endpoints for verifying document authenticity.
 */

import { ok, err, parseBody } from '../lib/http';
import type { Env } from '../types';
import {
    VerifyByHashSchema,
    VerifyByTargetSchema,
    VerifyMerkleProofSchema,
    verifyByHash,
    verifyByTarget,
    quickVerify,
    verifyProof,
    getVerificationStats,
} from '../verification';

// ============================================================================
// GET /verify - Quick verification by hash (query param)
// ============================================================================

export async function getVerify(
    req: Request,
    env: Env
): Promise<Response> {
    const url = new URL(req.url);
    const hash = url.searchParams.get('hash');

    if (!hash) {
        return err(400, 'missing_hash', {
            message: 'Hash query parameter is required',
            usage: '/verify?hash=<document_hash>',
        });
    }

    // Validate hash format
    if (hash.length < 32 || hash.length > 128) {
        return err(400, 'invalid_hash', {
            message: 'Hash must be between 32 and 128 characters',
        });
    }

    try {
        const result = await quickVerify(env, hash);
        return ok(result);
    } catch (error) {
        console.error('Quick verify failed:', error);
        return err(500, 'verification_failed', {
            message: 'Verification service error',
        });
    }
}

// ============================================================================
// POST /verify - Full verification with options
// ============================================================================

export async function postVerify(
    req: Request,
    env: Env
): Promise<Response> {
    const bodyResult = await parseBody(req);
    if (!bodyResult.ok) {
        return err(400, 'invalid_json', { message: bodyResult.error });
    }

    const parseResult = VerifyByHashSchema.safeParse(bodyResult.data);
    if (!parseResult.success) {
        return err(400, 'validation_error', {
            errors: parseResult.error.issues.map(e => ({
                path: e.path.map(String).join('.'),
                message: e.message,
            })),
        });
    }

    const input = parseResult.data;

    try {
        const result = await verifyByHash(
            env,
            input.hash,
            input.target_type,
            input.target_id
        );
        return ok(result);
    } catch (error) {
        console.error('Full verify failed:', error);
        return err(500, 'verification_failed', {
            message: 'Verification service error',
        });
    }
}

// ============================================================================
// GET /verify/:type/:id - Verify by target entity
// ============================================================================

export async function getVerifyByTarget(
    req: Request,
    env: Env,
    targetType: string,
    targetId: string
): Promise<Response> {
    // Validate target type
    const validTypes = ['ENF_BUNDLE', 'CHALLENGE', 'ATTESTATION'];
    const normalizedType = targetType.toUpperCase();

    if (!validTypes.includes(normalizedType)) {
        return err(400, 'invalid_target_type', {
            message: `Target type must be one of: ${validTypes.join(', ')}`,
            provided: targetType,
        });
    }

    // Validate UUID format for target_id
    const uuidRegex = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    if (!uuidRegex.test(targetId)) {
        return err(400, 'invalid_target_id', {
            message: 'Target ID must be a valid UUID',
        });
    }

    try {
        const result = await verifyByTarget(
            env,
            normalizedType as 'ENF_BUNDLE' | 'CHALLENGE' | 'ATTESTATION',
            targetId
        );
        return ok(result);
    } catch (error) {
        console.error('Verify by target failed:', error);
        return err(500, 'verification_failed', {
            message: 'Verification service error',
        });
    }
}

// ============================================================================
// POST /verify/proof - Verify Merkle proof
// ============================================================================

export async function postVerifyProof(
    req: Request,
    env: Env
): Promise<Response> {
    const bodyResult = await parseBody(req);
    if (!bodyResult.ok) {
        return err(400, 'invalid_json', { message: bodyResult.error });
    }

    const parseResult = VerifyMerkleProofSchema.safeParse(bodyResult.data);
    if (!parseResult.success) {
        return err(400, 'validation_error', {
            errors: parseResult.error.issues.map(e => ({
                path: e.path.map(String).join('.'),
                message: e.message,
            })),
        });
    }

    try {
        const result = await verifyProof(parseResult.data);
        return ok(result);
    } catch (error) {
        console.error('Merkle proof verification failed:', error);
        return err(500, 'verification_failed', {
            message: 'Proof verification service error',
        });
    }
}

// ============================================================================
// GET /verify/stats - Verification statistics (admin)
// ============================================================================

export async function getVerifyStats(
    req: Request,
    env: Env
): Promise<Response> {
    try {
        const stats = await getVerificationStats(env);
        return ok(stats);
    } catch (error) {
        console.error('Get stats failed:', error);
        return err(500, 'stats_failed', {
            message: 'Failed to retrieve verification statistics',
        });
    }
}

// ============================================================================
// GET /verify/health - Verification service health check
// ============================================================================

export async function getVerifyHealth(
    _req: Request,
    _env: Env
): Promise<Response> {
    return ok({
        service: 'verification-portal',
        status: 'healthy',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        endpoints: [
            { method: 'GET', path: '/verify?hash=<hash>', description: 'Quick verification' },
            { method: 'POST', path: '/verify', description: 'Full verification with options' },
            { method: 'GET', path: '/verify/:type/:id', description: 'Verify by entity' },
            { method: 'POST', path: '/verify/proof', description: 'Verify Merkle proof' },
        ],
    });
}

// ============================================================================
// Verification Portal HTML Page (for browser access)
// ============================================================================

export async function getVerifyPortal(
    req: Request,
    env: Env
): Promise<Response> {
    const url = new URL(req.url);
    const hash = url.searchParams.get('hash');
    const type = url.searchParams.get('type');
    const id = url.searchParams.get('id');

    // If hash is provided via QR code scan, do verification
    let verificationHtml = '';
    if (hash) {
        try {
            const result = await verifyByHash(env, hash, type as any, id || undefined);
            verificationHtml = generateVerificationResultHtml(result);
        } catch {
            verificationHtml = `<div class="error">Verification service error. Please try again.</div>`;
        }
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TattleHash - Document Verification</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
        }
        .header {
            text-align: center;
            padding: 40px 0 30px;
        }
        .header h1 {
            font-size: 32px;
            color: #fff;
            margin-bottom: 8px;
            text-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        .header p {
            color: rgba(255,255,255,0.9);
            font-size: 16px;
        }
        .card {
            background: white;
            border-radius: 16px;
            padding: 28px;
            margin-bottom: 20px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        }
        .tabs {
            display: flex;
            margin-bottom: 24px;
            border-bottom: 2px solid #eee;
        }
        .tab {
            flex: 1;
            padding: 12px;
            text-align: center;
            cursor: pointer;
            color: #666;
            font-weight: 500;
            border-bottom: 2px solid transparent;
            margin-bottom: -2px;
            transition: all 0.2s;
        }
        .tab:hover {
            color: #0066cc;
        }
        .tab.active {
            color: #0066cc;
            border-bottom-color: #0066cc;
        }
        .tab-content {
            display: none;
        }
        .tab-content.active {
            display: block;
        }
        .form-group {
            margin-bottom: 20px;
        }
        .form-group label {
            display: block;
            font-weight: 600;
            margin-bottom: 8px;
            color: #333;
        }
        .form-group input[type="text"] {
            width: 100%;
            padding: 14px;
            border: 2px solid #e0e0e0;
            border-radius: 10px;
            font-size: 14px;
            font-family: 'SF Mono', Monaco, Consolas, monospace;
            transition: border-color 0.2s;
        }
        .form-group input[type="text"]:focus {
            outline: none;
            border-color: #0066cc;
        }
        .file-upload {
            position: relative;
            border: 2px dashed #d0d0d0;
            border-radius: 10px;
            padding: 40px 20px;
            text-align: center;
            cursor: pointer;
            transition: all 0.2s;
            background: #fafafa;
        }
        .file-upload:hover {
            border-color: #0066cc;
            background: #f0f7ff;
        }
        .file-upload.dragover {
            border-color: #0066cc;
            background: #e8f2ff;
        }
        .file-upload input[type="file"] {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            opacity: 0;
            cursor: pointer;
        }
        .file-upload-icon {
            font-size: 48px;
            margin-bottom: 12px;
        }
        .file-upload-text {
            color: #666;
            font-size: 15px;
        }
        .file-upload-text strong {
            color: #0066cc;
        }
        .file-info {
            margin-top: 16px;
            padding: 12px;
            background: #e8f5e9;
            border-radius: 8px;
            display: none;
        }
        .file-info.visible {
            display: block;
        }
        .file-info .filename {
            font-weight: 500;
            color: #2e7d32;
        }
        .file-info .filesize {
            color: #666;
            font-size: 13px;
        }
        .extracted-hash {
            margin-top: 12px;
            padding: 10px;
            background: #f5f5f5;
            border-radius: 6px;
            font-family: monospace;
            font-size: 12px;
            word-break: break-all;
            color: #333;
        }
        .btn {
            width: 100%;
            padding: 16px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
        .btn:disabled {
            background: #ccc;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }
        .processing {
            display: none;
            align-items: center;
            justify-content: center;
            gap: 10px;
            padding: 16px;
            color: #666;
        }
        .processing.visible {
            display: flex;
        }
        .spinner {
            width: 20px;
            height: 20px;
            border: 2px solid #ddd;
            border-top-color: #0066cc;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .result {
            margin-top: 20px;
        }
        .status {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 20px;
            border-radius: 12px;
            margin-bottom: 20px;
        }
        .status.verified {
            background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%);
            color: #155724;
        }
        .status.pending {
            background: linear-gradient(135deg, #fff3cd 0%, #ffeeba 100%);
            color: #856404;
        }
        .status.not-found {
            background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%);
            color: #721c24;
        }
        .status-icon {
            font-size: 32px;
        }
        .status-text strong {
            display: block;
            font-size: 18px;
            margin-bottom: 4px;
        }
        .detail-row {
            display: flex;
            justify-content: space-between;
            padding: 14px 0;
            border-bottom: 1px solid #eee;
        }
        .detail-row:last-child {
            border-bottom: none;
        }
        .detail-label {
            color: #666;
            font-weight: 500;
        }
        .detail-value {
            font-family: 'SF Mono', Monaco, Consolas, monospace;
            font-size: 13px;
            word-break: break-all;
            text-align: right;
            max-width: 60%;
            color: #333;
        }
        .blockchain-link {
            color: #0066cc;
            text-decoration: none;
            font-weight: 500;
        }
        .blockchain-link:hover {
            text-decoration: underline;
        }
        .footer {
            text-align: center;
            padding: 24px;
            color: rgba(255,255,255,0.8);
            font-size: 14px;
        }
        .cta-card {
            background: linear-gradient(135deg, #f8f9ff 0%, #f0f7ff 100%);
            border: 1px solid rgba(102, 126, 234, 0.2);
        }
        .how-it-works {
            margin-top: 8px;
            padding: 16px;
            background: #f8f9fa;
            border-radius: 8px;
            font-size: 13px;
            color: #666;
        }
        .how-it-works h4 {
            color: #333;
            margin-bottom: 8px;
            font-size: 14px;
        }
        .how-it-works ol {
            margin-left: 18px;
        }
        .how-it-works li {
            margin-bottom: 4px;
        }
        @media (max-width: 480px) {
            body { padding: 12px; }
            .header h1 { font-size: 26px; }
            .card { padding: 20px; }
            .tabs { flex-direction: column; }
            .tab { border-bottom: none; border-left: 2px solid transparent; }
            .tab.active { border-left-color: #0066cc; border-bottom: none; }
            .detail-row { flex-direction: column; gap: 4px; }
            .detail-value { max-width: 100%; text-align: left; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>TattleHash Verification</h1>
            <p>Verify document authenticity with blockchain proof</p>
        </div>

        <div class="card">
            <div class="tabs">
                <div class="tab active" data-tab="hash">Enter Hash</div>
                <div class="tab" data-tab="upload">Upload File</div>
            </div>

            <form id="verify-form" method="GET" action="/verify/portal">
                <div id="hash-tab" class="tab-content active">
                    <div class="form-group">
                        <label for="hash">Document Hash (SHA-256)</label>
                        <input type="text" id="hash" name="hash"
                               placeholder="e.g., a1b2c3d4e5f6..."
                               value="${hash || ''}">
                    </div>
                </div>

                <div id="upload-tab" class="tab-content">
                    <div class="form-group">
                        <label>Upload File or Paste Screenshot</label>
                        <div class="file-upload" id="file-upload" tabindex="0">
                            <input type="file" id="file-input" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp">
                            <div class="file-upload-icon" id="file-icon">📄</div>
                            <div class="file-upload-text">
                                <strong>Click to upload</strong>, drag and drop, or <strong>Ctrl+V</strong> to paste<br>
                                PDF or image files (JPEG, PNG, WEBP)
                            </div>
                        </div>
                        <div class="file-info" id="file-info">
                            <span class="filename" id="filename"></span>
                            <span class="filesize" id="filesize"></span>
                            <div class="extracted-hash" id="extracted-hash"></div>
                        </div>
                    </div>
                    <div class="how-it-works">
                        <h4>How it works</h4>
                        <ol>
                            <li>Upload your TattleHash PDF dossier or screenshot</li>
                            <li>We extract its SHA-256 hash locally (nothing leaves your browser)</li>
                            <li>The hash is verified against our blockchain records</li>
                        </ol>
                    </div>
                </div>

                <div class="processing" id="processing">
                    <div class="spinner"></div>
                    <span>Computing hash...</span>
                </div>

                <button type="submit" class="btn" id="verify-btn">Verify Document</button>
            </form>
        </div>

        ${verificationHtml}

        <div class="footer">
            <p>TattleHash - Immutable Evidence for the Digital Age</p>
        </div>
    </div>

    <script>
        // Tab switching
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(tab.dataset.tab + '-tab').classList.add('active');
            });
        });

        // File upload handling
        const fileUpload = document.getElementById('file-upload');
        const fileInput = document.getElementById('file-input');
        const fileInfo = document.getElementById('file-info');
        const fileIcon = document.getElementById('file-icon');
        const hashInput = document.getElementById('hash');
        const processing = document.getElementById('processing');
        const verifyBtn = document.getElementById('verify-btn');

        // Accepted file types
        const acceptedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

        function isAcceptedFile(file) {
            return acceptedTypes.includes(file.type);
        }

        function getFileIcon(type) {
            if (type === 'application/pdf') return '📄';
            if (type.startsWith('image/')) return '🖼️';
            return '📁';
        }

        // Drag and drop
        ['dragenter', 'dragover'].forEach(e => {
            fileUpload.addEventListener(e, (evt) => {
                evt.preventDefault();
                fileUpload.classList.add('dragover');
            });
        });
        ['dragleave', 'drop'].forEach(e => {
            fileUpload.addEventListener(e, (evt) => {
                evt.preventDefault();
                fileUpload.classList.remove('dragover');
            });
        });
        fileUpload.addEventListener('drop', (evt) => {
            const file = evt.dataTransfer.files[0];
            if (file && isAcceptedFile(file)) {
                processFile(file);
            } else if (file) {
                alert('Please upload a PDF or image file (JPEG, PNG, WEBP)');
            }
        });

        fileInput.addEventListener('change', (evt) => {
            if (evt.target.files[0]) {
                processFile(evt.target.files[0]);
            }
        });

        // Clipboard paste support (Ctrl+V / Cmd+V)
        document.addEventListener('paste', async (evt) => {
            const items = evt.clipboardData?.items;
            if (!items) return;

            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    evt.preventDefault();
                    const file = item.getAsFile();
                    if (file) {
                        // Switch to upload tab if not already there
                        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                        document.querySelector('[data-tab="upload"]').classList.add('active');
                        document.getElementById('upload-tab').classList.add('active');

                        processFile(file);
                    }
                    break;
                }
            }
        });

        // Also handle paste when file-upload area is focused
        fileUpload.addEventListener('paste', async (evt) => {
            evt.stopPropagation();
            const items = evt.clipboardData?.items;
            if (!items) return;

            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    evt.preventDefault();
                    const file = item.getAsFile();
                    if (file) processFile(file);
                    break;
                }
            }
        });

        async function processFile(file) {
            // Show processing
            processing.classList.add('visible');
            verifyBtn.disabled = true;

            try {
                // Read file and compute SHA-256
                const arrayBuffer = await file.arrayBuffer();
                const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

                // Generate display name (handle pasted screenshots with generic names)
                let displayName = file.name;
                if (!displayName || displayName === 'image.png' || displayName === 'blob') {
                    const ext = file.type.split('/')[1] || 'png';
                    displayName = 'Pasted screenshot.' + ext;
                }

                // Update UI with appropriate icon
                fileIcon.textContent = getFileIcon(file.type);
                document.getElementById('filename').textContent = displayName;
                document.getElementById('filesize').textContent = ' (' + formatBytes(file.size) + ')';
                document.getElementById('extracted-hash').textContent = 'SHA-256: ' + hashHex;
                fileInfo.classList.add('visible');

                // Set hash input
                hashInput.value = hashHex;
            } catch (err) {
                alert('Error processing file: ' + err.message);
            } finally {
                processing.classList.remove('visible');
                verifyBtn.disabled = false;
            }
        }

        function formatBytes(bytes) {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        }

        // Form validation
        document.getElementById('verify-form').addEventListener('submit', (evt) => {
            if (!hashInput.value.trim()) {
                evt.preventDefault();
                alert('Please enter a document hash or upload a file (PDF, JPEG, PNG, or WEBP).');
            }
        });
    </script>
</body>
</html>`;

    return new Response(html, {
        status: 200,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
        },
    });
}

/**
 * Generate HTML for verification result.
 */
function generateVerificationResultHtml(result: any): string {
    const statusClass = result.verified ? 'verified' :
        result.status === 'PENDING' ? 'pending' : 'not-found';

    const statusIcon = result.verified ? '[OK]' :
        result.status === 'PENDING' ? '[...]' : '[X]';

    let blockchainHtml = '';
    if (result.blockchain) {
        blockchainHtml = `
            <div class="detail-row">
                <span class="detail-label">Blockchain</span>
                <span class="detail-value">${result.blockchain.chain_name}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Transaction</span>
                <span class="detail-value">
                    <a href="${result.blockchain.explorer_url}" target="_blank" class="blockchain-link">
                        ${result.blockchain.tx_hash.slice(0, 20)}...
                    </a>
                </span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Confirmations</span>
                <span class="detail-value">${result.blockchain.confirmations} / ${result.blockchain.required_confirmations}</span>
            </div>
        `;
    }

    let sourceHtml = '';
    if (result.source) {
        sourceHtml = `
            <div class="detail-row">
                <span class="detail-label">Document Type</span>
                <span class="detail-value">${result.source.type}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Document ID</span>
                <span class="detail-value">${result.source.id}</span>
            </div>
            ${result.source.title ? `
            <div class="detail-row">
                <span class="detail-label">Title</span>
                <span class="detail-value">${result.source.title}</span>
            </div>
            ` : ''}
        `;
    }

    return `
        <div class="card result">
            <div class="status ${statusClass}">
                <span class="status-icon">${statusIcon}</span>
                <div>
                    <strong>${result.status}</strong>
                    <p>${result.message}</p>
                </div>
            </div>

            <div class="detail-row">
                <span class="detail-label">Document Hash</span>
                <span class="detail-value">${result.document_hash}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Verified At</span>
                <span class="detail-value">${result.verified_at}</span>
            </div>
            ${sourceHtml}
            ${blockchainHtml}
        </div>

        <div class="card cta-card">
            <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
                <span style="font-size: 32px;">&#128737;</span>
                <div style="flex: 1; min-width: 200px;">
                    <p style="margin: 0 0 4px; font-weight: 600; color: #333;">Need proof for your own transactions?</p>
                    <p style="margin: 0; color: #0066cc; font-size: 14px;">Your first attestation is free.</p>
                </div>
                <a href="https://tattlehash.com/register.html"
                   style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                          color: white; padding: 12px 24px; border-radius: 8px;
                          text-decoration: none; font-weight: 600; white-space: nowrap;">
                    Get Started
                </a>
            </div>
        </div>
    `;
}
