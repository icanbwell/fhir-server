'use strict';

const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const {
    setupAccessLogClickHouseTests,
    teardownAccessLogClickHouseTests,
    cleanupBetweenTests,
    getSharedRequest,
    getAdminHeaders,
    makeAccessLog,
    recentTimestamp,
    insertRows
} = require('./accessLogClickHouseTestSetup');
const { getHeaders } = require('../../common');

describe('AccessLog ClickHouse API integration (/admin/searchLogResults)', () => {
    beforeAll(async () => {
        await setupAccessLogClickHouseTests();
    }, 90000);

    beforeEach(async () => {
        await cleanupBetweenTests();
    });

    afterAll(async () => {
        await teardownAccessLogClickHouseTests();
    }, 30000);

    describe('request_id lookup', () => {
        test('returns the matching row in the admin envelope', async () => {
            const request = getSharedRequest();
            await insertRows([makeAccessLog({ requestId: 'api-envelope-1' })]);

            const resp = await request
                .get('/admin/searchLogResults?id=api-envelope-1')
                .set(getAdminHeaders());

            expect(resp.status).toBe(200);
            expect(Array.isArray(resp.body)).toBe(true);
            expect(resp.body).toHaveLength(1);
            const row = resp.body[0];
            expect(row.request.id).toBe('api-envelope-1');
            expect(row.outcomeDesc).toBe('Success');
            expect(row).not.toHaveProperty('outcome_desc');
            expect(row).not.toHaveProperty('request_id');
            expect(row.agent).toBeDefined();
            expect(row.details).toBeDefined();
        });

        test('returns multiple rows for the same id ordered by timestamp DESC', async () => {
            const request = getSharedRequest();
            await insertRows([
                makeAccessLog({ requestId: 'api-multi', timestamp: recentTimestamp(30) }),
                makeAccessLog({ requestId: 'api-multi', timestamp: recentTimestamp(20) }),
                makeAccessLog({ requestId: 'api-multi', timestamp: recentTimestamp(10) })
            ]);

            const resp = await request
                .get('/admin/searchLogResults?id=api-multi')
                .set(getAdminHeaders());

            expect(resp.status).toBe(200);
            expect(resp.body).toHaveLength(3);
            const timestamps = resp.body.map(r => r.timestamp);
            const sortedDesc = [...timestamps].sort().reverse();
            expect(timestamps).toEqual(sortedDesc);
        });

        test('returns empty array when the id has no matching rows', async () => {
            const request = getSharedRequest();
            await insertRows([makeAccessLog({ requestId: 'api-exists' })]);

            const resp = await request
                .get('/admin/searchLogResults?id=api-does-not-exist')
                .set(getAdminHeaders());

            expect(resp.status).toBe(200);
            expect(resp.body).toEqual([]);
        });

        test('isolates rows by id — unrelated rows do not leak', async () => {
            const request = getSharedRequest();
            await insertRows([
                makeAccessLog({ requestId: 'api-target' }),
                makeAccessLog({ requestId: 'api-other-1' }),
                makeAccessLog({ requestId: 'api-other-2' })
            ]);

            const resp = await request
                .get('/admin/searchLogResults?id=api-target')
                .set(getAdminHeaders());

            expect(resp.status).toBe(200);
            expect(resp.body).toHaveLength(1);
            expect(resp.body[0].request.id).toBe('api-target');
        });

        test('preserves JSON subfields (agent and details) verbatim', async () => {
            const request = getSharedRequest();
            await insertRows([
                makeAccessLog({
                    requestId: 'api-json-shape',
                    agent: {
                        altId: 'dr-who',
                        networkAddress: '::1',
                        scopes: ['user/Patient.read']
                    },
                    details: {
                        host: 'api.example.com',
                        originService: 'mobile-app',
                        contentType: 'application/fhir+json',
                        params: { _count: '10' }
                    }
                })
            ]);

            const resp = await request
                .get('/admin/searchLogResults?id=api-json-shape')
                .set(getAdminHeaders());

            expect(resp.status).toBe(200);
            expect(resp.body[0].agent.altId).toBe('dr-who');
            expect(resp.body[0].agent.scopes).toEqual(['user/Patient.read']);
            expect(resp.body[0].details.host).toBe('api.example.com');
            expect(resp.body[0].details.params).toEqual({ _count: '10' });
        });
    });

    describe('validation', () => {
        test('rejects id that fails the admin regex with 400', async () => {
            const request = getSharedRequest();

            const resp = await request
                .get('/admin/searchLogResults?id=has%20space')
                .set(getAdminHeaders());

            expect(resp.status).toBe(400);
            expect(resp.body.message).toBe('Invalid id parameter');
        });

        test('returns a placeholder message when id is missing', async () => {
            const request = getSharedRequest();

            const resp = await request
                .get('/admin/searchLogResults')
                .set(getAdminHeaders());

            expect(resp.status).toBe(200);
            expect(resp.body).toEqual({ message: 'No id passed' });
        });
    });

    describe('authorization', () => {
        test('returns 403 for a non-admin token', async () => {
            const request = getSharedRequest();
            await insertRows([makeAccessLog({ requestId: 'api-no-admin' })]);

            const resp = await request
                .get('/admin/searchLogResults?id=api-no-admin')
                .set(getHeaders());

            expect(resp.status).toBe(403);
        });
    });
});
