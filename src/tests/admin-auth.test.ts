import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireAdmin } from '../middleware/admin';
import { Env } from '../types';

describe('Admin Authentication', () => {
    let env: Env;
    let mockKv: any;

    beforeEach(() => {
        mockKv = {
            put: vi.fn(),
            get: vi.fn(),
            delete: vi.fn(),
        };

        env = {
            TATTLEHASH_DB: {} as any,
            GATE_KV: mockKv,
            ATT_KV: mockKv,
            TATTLEHASH_QUEUE: {} as any,
            TATTLEHASH_KV: mockKv,
            TATTLEHASH_CONTENT_KV: mockKv,
            TATTLEHASH_ANCHOR_KV: mockKv,
            TATTLEHASH_ERROR_KV: mockKv,
            SHIELD_KV: mockKv,
            ADMIN_SECRET: 'test-secret-123',
        };
    });

    it('should accept valid bearer token', async () => {
        const request = new Request('https://example.com/admin/status', {
            headers: {
                'Authorization': 'Bearer test-secret-123'
            }
        });

        const result = await requireAdmin(request, env);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.adminId).toBe('admin-system');
        }

        // Should log admin action
        expect(mockKv.put).toHaveBeenCalledWith(
            expect.stringMatching(/^admin_log:/),
            expect.any(String),
            expect.objectContaining({ expirationTtl: 86400 * 90 })
        );
    });

    it('should reject missing authorization header', async () => {
        const request = new Request('https://example.com/admin/status');

        const result = await requireAdmin(request, env);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.response.status).toBe(401);
        }
    });

    it('should reject invalid bearer token', async () => {
        const request = new Request('https://example.com/admin/status', {
            headers: {
                'Authorization': 'Bearer wrong-token'
            }
        });

        const result = await requireAdmin(request, env);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.response.status).toBe(403);
        }
    });

    it('should reject malformed authorization header', async () => {
        const request = new Request('https://example.com/admin/status', {
            headers: {
                'Authorization': 'Basic dGVzdDp0ZXN0'
            }
        });

        const result = await requireAdmin(request, env);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.response.status).toBe(401);
        }
    });

    it('should reject when ADMIN_SECRET is not set', async () => {
        env.ADMIN_SECRET = undefined;

        const request = new Request('https://example.com/admin/status', {
            headers: {
                'Authorization': 'Bearer test-secret-123'
            }
        });

        const result = await requireAdmin(request, env);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.response.status).toBe(403);
        }
    });
});
