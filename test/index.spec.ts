import { describe, it, expect } from 'vitest';
import { ok, err } from '../src/lib/http';

describe('HTTP Response Helpers', () => {
    describe('ok', () => {
        it('creates success response with data', () => {
            const response = ok({ foo: 'bar' });
            expect(response.status).toBe(200);
        });

        it('creates success response with custom status', () => {
            const response = ok({ created: true }, { status: 201 });
            expect(response.status).toBe(201);
        });
    });

    describe('err', () => {
        it('creates error response with code', () => {
            const response = err(400, 'VALIDATION_ERROR', { field: 'name' });
            expect(response.status).toBe(400);
        });

        it('creates 500 error for internal errors', () => {
            const response = err(500, 'INTERNAL_ERROR');
            expect(response.status).toBe(500);
        });
    });
});
