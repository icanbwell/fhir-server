// T36: a member's Binary create writes exactly one audit entry (for the created resource) and logs the
// securityContext stamping (`binary_person_security_context_set`, once, with the person id from the token).
// A rejected foreign securityContext logs `binary_person_security_context_rejected` and writes no create audit entry.
const { afterEach, beforeEach, describe, expect, jest, test } = require('@jest/globals');

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
jest.mock('../../../../operations/common/logging', () => {
    const actual = jest.requireActual('../../../../operations/common/logging');
    return {
        ...actual,
        logInfo: (...args) => mockLogInfo(...args),
        logWarn: (...args) => mockLogWarn(...args)
    };
});

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { ConfigManager } = require('../../../../utils/configManager');
const { createHelpers, meta, memberWriter, newPerson } = require('./binaryScopeTestHelpers');

class AuditConfigManager extends ConfigManager {
    get enablePatientScopedBinaryCreate () {
        return true;
    }
}

const callsNamed = (mock, name) => mock.mock.calls.filter((c) => c[0] === name);

describe('Binary with patient scope: audit and stamping log', () => {
    let requestId;

    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
        jest.restoreAllMocks();
        mockLogInfo.mockClear();
        mockLogWarn.mockClear();
    });

    const setup = async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new AuditConfigManager());
            return c;
        });
        const helpers = createHelpers(request, requestId);
        await helpers.merge('Patient', { resourceType: 'Patient', id: 'shared-patient', meta, name: [{ family: 'S' }] });
        const personA = await helpers.merge('Person', newPerson('person-a'));
        const auditSpy = jest.spyOn(getTestContainer().auditLogger, 'logAuditEntryAsync');
        return { request, helpers, personA, auditSpy };
    };

    const body = (extra = {}) => ({
        resourceType: 'Binary',
        id: 'ignored',
        meta,
        contentType: 'application/pdf',
        data: 'JVBERi0xLjQK',
        ...extra
    });

    test('T36: one create audit entry for the new Binary and one stamping log line', async () => {
        const { request, helpers, personA, auditSpy } = await setup();
        mockLogInfo.mockClear();

        const resp = await request.post('/4_0_0/Binary').send(body()).set(memberWriter(personA));
        expect(resp).toHaveStatusCode(201);
        await helpers.waitForPostSave();

        const createAudits = auditSpy.mock.calls.filter(
            ([arg]) => arg.resourceType === 'Binary' && arg.operation === 'create'
        );
        expect(createAudits).toHaveLength(1);
        const stored = await (await getTestContainer().mongoDatabaseManager.getClientDbAsync())
            .collection('Binary_4_0_0')
            .findOne({ id: resp.body.id });
        expect(createAudits[0][0].ids).toStrictEqual([stored._uuid]);

        const stamped = callsNamed(mockLogInfo, 'binary_person_security_context_set');
        expect(stamped).toHaveLength(1);
        expect(stamped[0][1]).toMatchObject({ resourceType: 'Binary', personId: personA });
        // the log line carries identifiers only, never the document
        expect(JSON.stringify(stamped[0][1])).not.toContain('JVBERi0xLjQK');
    });

    test('a rejected foreign securityContext is logged as rejected, not stamped, and writes no create audit entry', async () => {
        const { request, helpers, personA, auditSpy } = await setup();
        mockLogInfo.mockClear();
        mockLogWarn.mockClear();

        const resp = await request
            .post('/4_0_0/Binary')
            .send(body({ securityContext: { reference: 'Patient/person.someone-else' } }))
            .set(memberWriter(personA));
        expect(resp).toHaveStatusCode(403);
        await helpers.waitForPostSave();

        expect(callsNamed(mockLogInfo, 'binary_person_security_context_set')).toHaveLength(0);
        expect(callsNamed(mockLogWarn, 'binary_person_security_context_rejected')).toHaveLength(1);
        expect(
            auditSpy.mock.calls.filter(([arg]) => arg.resourceType === 'Binary' && arg.operation === 'create')
        ).toHaveLength(0);
    });
});
