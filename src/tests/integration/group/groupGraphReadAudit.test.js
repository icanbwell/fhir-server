const { describe, test, beforeAll, beforeEach, afterAll, expect, jest } = require('@jest/globals');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupAllData,
    getSharedRequest,
    getTestHeadersWithExternalStorage
} = require('./groupTestSetup');
const { getTestContainer } = require('../common');

/**
 * $graph read audit for a Group tracked in ClickHouse. Its enrichment returns a copy of the Group
 * rather than the object the graph traversal holds, so the audit must still name the Group.
 */
describe('$graph read audit for a Group tracked in ClickHouse', () => {
    beforeAll(async () => {
        await setupGroupTests();
    });

    beforeEach(async () => {
        await cleanupAllData();
    });

    afterAll(async () => {
        await teardownGroupTests();
    });

    const meta = {
        source: 'http://test-system.com/Group',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
            { system: 'https://www.icanbwell.com/access', code: 'test-access' },
            { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'test-owner' }
        ]
    };

    const groupToObservation = {
        resourceType: 'GraphDefinition',
        id: 'group-to-observation',
        name: 'group_to_observation',
        status: 'active',
        start: 'Group',
        link: [{ target: [{ type: 'Observation', params: 'subject={ref}' }] }]
    };

    test.each([
        ['contained=true', '?contained=true'],
        ['contained=false', '']
    ])('(%s) audits the Group and its linked Observation by id', async (_, query) => {
        const request = getSharedRequest();
        const headers = getTestHeadersWithExternalStorage();

        const created = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                name: 'Tracked Group',
                member: [{ entity: { reference: 'Patient/tracked-member-1' } }],
                meta
            })
            .set(headers);
        expect(created.status).toBe(201);
        const groupId = created.body.id;
        const observation = await request
            .post('/4_0_0/Observation/1/$merge')
            .send({
                resourceType: 'Observation',
                id: `observation-of-${groupId}`,
                meta,
                status: 'final',
                code: { coding: [{ system: 'http://loinc.org', code: '29463-7' }] },
                subject: { reference: `Group/${groupId}` }
            })
            .set(headers);
        expect(observation.status).toBe(200);

        const auditLogger = getTestContainer().auditLogger;
        const logSpy = jest.spyOn(auditLogger, 'logAuditEntryAsync');
        try {
            const resp = await request
                .post(`/4_0_0/Group/${groupId}/$graph${query}`)
                .send(groupToObservation)
                .set(headers);
            expect(resp.status).toBe(200);
            // the enrichment ran: members are replaced by a quantity
            expect(resp.body.entry[0].resource.member).toBeUndefined();

            await getTestContainer().postRequestProcessor.waitTillAllRequestsDoneAsync({
                timeoutInSeconds: 10
            });
            const deadline = Date.now() + 10000;
            while (
                logSpy.mock.calls.filter(([a]) => a.operation === 'read').length < 2 &&
                Date.now() < deadline
            ) {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }

            const audited = logSpy.mock.calls
                .map(([a]) => a)
                .filter((a) => a.operation === 'read')
                .map((a) => ({ type: a.resourceType, ids: a.ids }));
            const byType = Object.fromEntries(audited.map((a) => [a.type, a.ids]));
            expect(byType.Group).toHaveLength(1);
            expect(byType.Group[0]).toBeTruthy();
            expect(String(byType.Group[0])).not.toContain('undefined');
            expect(byType.Observation).toHaveLength(1);
            expect(String(byType.Observation[0])).not.toContain('undefined');
        } finally {
            logSpy.mockRestore();
        }
    });
});
