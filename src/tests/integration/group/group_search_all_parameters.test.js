const { describe, test, beforeAll, beforeEach, afterAll, expect } = require('@jest/globals');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupAllData,
    getSharedRequest,
    getTestHeaders
} = require('./groupTestSetup');
const { getTestContainer, getHeadersJsonPatch } = require('../common');
const { GROUP_MEMBER_COLLECTION_NAME, GROUP_MEMBER_HISTORY_COLLECTION_NAME } = require('../../../constants');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../utils/mongoGroupExtendedTag');

const GROUP_COLLECTION_NAME = 'Group_4_0_0';

/**
 * All 10 FHIR R4B Group search parameters, run against every storage regime.
 *
 * Per FHIR R4B, Group supports:
 *   1. actual               boolean
 *   2. type                 token
 *   3. code                 token
 *   4. identifier           token
 *   5. characteristic       token
 *   6. characteristic-value composite
 *   7. exclude              token
 *   8. managing-entity      reference
 *   9. value                token
 *  10. member               reference
 *
 * Parameters 1-9 resolve against fields that stay on the Group document in every regime, so they
 * are expected to behave identically. Parameter 10 resolves against `member.entity`, which for an
 * extended Group is not on the document at all: the roster lives in GroupMember_4_0_0. That makes
 * `member` the only parameter whose behavior is regime-dependent, and the reason this suite is
 * parameterized rather than written once.
 *
 * Regimes covered here are `embedded` (roster inline in Group.member[]) and `extended`
 * (Mongo-native roster in GroupMember_4_0_0). The ClickHouse regime is not covered: this suite
 * inherits ENABLE_CLICKHOUSE='0' from jest/setEnvVars.js and enabling it requires setting the env
 * at module scope plus materialized-view syncing, as the dedicated ClickHouse suites do.
 *
 * Both regimes use identical request headers so that the storage regime is the only variable.
 */

const MEMBER_REFERENCES = ['Patient/1', 'Patient/2', 'Patient/3'];

// A real Patient resource, needed because a chained search on member:Patient.identifier has to
// resolve that identifier against stored Patients before it can filter Groups by member.
const CHAINED_PATIENT_ID = 'chained-search-patient';
const CHAINED_PATIENT_IDENTIFIER_SYSTEM = 'http://test-system.com/patient-id';
const CHAINED_PATIENT_IDENTIFIER_VALUE = 'CHAINED-PATIENT-001';

async function createChainedSearchPatient() {
    const response = await getSharedRequest()
        .put(`/4_0_0/Patient/${CHAINED_PATIENT_ID}`)
        .send({
            resourceType: 'Patient',
            id: CHAINED_PATIENT_ID,
            identifier: [
                {
                    system: CHAINED_PATIENT_IDENTIFIER_SYSTEM,
                    value: CHAINED_PATIENT_IDENTIFIER_VALUE
                }
            ],
            meta: {
                source: 'http://test-system.com/Patient',
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
                    { system: 'https://www.icanbwell.com/access', code: 'test-access' }
                ]
            }
        })
        .set(getTestHeaders());
    expect([200, 201]).toContain(response.status);
    return `Patient/${CHAINED_PATIENT_ID}`;
}

function buildGroupBody({ memberReferences = [] }) {
    return {
        resourceType: 'Group',
        type: 'person',
        actual: true,
        code: {
            coding: [{ system: 'http://test-system.com/group-code', code: 'cohort' }]
        },
        name: 'Comprehensive Test Group',
        quantity: 3,
        managingEntity: { reference: 'Organization/test-org' },
        identifier: [{ system: 'http://test-system.com/group-id', value: 'COMPREHENSIVE-001' }],
        characteristic: [
            {
                code: {
                    coding: [{ system: 'http://test-system.com/characteristic', code: 'age-group' }]
                },
                valueCodeableConcept: {
                    coding: [{ system: 'http://test-system.com/age', code: 'adult' }]
                },
                exclude: false
            },
            {
                code: {
                    coding: [{ system: 'http://test-system.com/characteristic', code: 'diagnosis' }]
                },
                valueCodeableConcept: {
                    coding: [{ system: 'http://test-system.com/diagnosis', code: 'diabetes' }]
                },
                exclude: true
            }
        ],
        ...(memberReferences.length > 0
            ? { member: memberReferences.map((reference) => ({ entity: { reference } })) }
            : {}),
        meta: {
            source: 'http://test-system.com/Group',
            security: [
                { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
                { system: 'https://www.icanbwell.com/access', code: 'test-access' }
            ]
        }
    };
}

async function getDb() {
    const container = getTestContainer();
    return container.mongoDatabaseManager.getClientDbAsync();
}

/**
 * cleanupAllData() truncates the ClickHouse tables and Group_4_0_0 but not the GroupMember
 * collections, so an extended-regime suite has to clear those itself or rows accumulate across
 * tests.
 */
async function clearMemberCollections() {
    const db = await getDb();
    await db.collection(GROUP_MEMBER_COLLECTION_NAME).deleteMany({});
    await db.collection(GROUP_MEMBER_HISTORY_COLLECTION_NAME).deleteMany({});
}

async function createEmbeddedGroup() {
    const chainedPatientReference = await createChainedSearchPatient();
    const response = await getSharedRequest()
        .post('/4_0_0/Group')
        .send(
            buildGroupBody({ memberReferences: [...MEMBER_REFERENCES, chainedPatientReference] })
        )
        .set(getTestHeaders());
    expect(response.status).toBe(201);
    return response.body;
}

/**
 * An extended Group cannot be created with its roster inline: a PUT or $merge carrying `member`
 * against an extended Group is rejected outright, and PATCH is the only supported roster write.
 * So the Group is created empty, marked extended by a raw write of the internal marker (the way
 * the other extended suites do it, never via meta.tag), and its members added by PATCH.
 */
async function createExtendedGroup() {
    const request = getSharedRequest();
    const chainedPatientReference = await createChainedSearchPatient();
    const allMemberReferences = [...MEMBER_REFERENCES, chainedPatientReference];

    const createResponse = await request
        .post('/4_0_0/Group')
        .send(buildGroupBody({ memberReferences: [] }))
        .set(getTestHeaders());
    expect(createResponse.status).toBe(201);
    const groupId = createResponse.body.id;

    const db = await getDb();
    await db
        .collection(GROUP_COLLECTION_NAME)
        .updateOne({ id: groupId }, { $set: { [MONGO_GROUP_EXTENDED_FIELD]: true } });

    const patchResponse = await request
        .patch(`/4_0_0/Group/${groupId}`)
        .send(
            allMemberReferences.map((reference) => ({
                op: 'add',
                path: '/member/-',
                value: { entity: { reference } }
            }))
        )
        .set(getHeadersJsonPatch());
    expect(patchResponse.status).toBe(200);

    // Precondition for this regime: the roster really is in the member collection.
    const memberRows = await db.collection(GROUP_MEMBER_COLLECTION_NAME).find({}).toArray();
    expect(memberRows).toHaveLength(allMemberReferences.length);

    return { ...createResponse.body, id: groupId };
}

const REGIMES = [
    { regime: 'embedded', createGroup: createEmbeddedGroup },
    { regime: 'extended', createGroup: createExtendedGroup }
];

// Shared test infrastructure is set up and torn down once per file. Doing it inside describe.each
// would tear down the shared request and ClickHouse manager between regimes, which corrupts state
// for suites running later in the same --runInBand process.
beforeAll(async () => {
    await setupGroupTests();
    await cleanupAllData();
    await clearMemberCollections();
}, 60000);

afterAll(async () => {
    await teardownGroupTests();
});

describe.each(REGIMES)('Group - All 10 FHIR R4B Search Parameters [$regime]', ({ createGroup }) => {
    let testGroup;

    async function searchGroups(params) {
        const queryString = Object.entries(params)
            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
            .join('&');
        return getSharedRequest().get(`/4_0_0/Group?${queryString}`).set(getTestHeaders());
    }

    function foundTestGroup(response) {
        return (response.body.entry || []).some((e) => e.resource?.id === testGroup.id);
    }

    beforeEach(async () => {
        await cleanupAllData();
        await clearMemberCollections();
        testGroup = await createGroup();
    }, 60000);

    // ============ PARAMETERS RESOLVING AGAINST THE GROUP DOCUMENT ============

    test('1. actual=true', async () => {
        const response = await searchGroups({ actual: 'true' });
        expect(response.status).toBe(200);
        expect(foundTestGroup(response)).toBe(true);
    });

    test('2. type=person', async () => {
        const response = await searchGroups({ type: 'person' });
        expect(response.status).toBe(200);
        expect(foundTestGroup(response)).toBe(true);
    });

    test('3. code=cohort', async () => {
        const response = await searchGroups({ code: 'cohort' });
        expect(response.status).toBe(200);
        expect(foundTestGroup(response)).toBe(true);
    });

    test('4. identifier=COMPREHENSIVE-001', async () => {
        const response = await searchGroups({ identifier: 'COMPREHENSIVE-001' });
        expect(response.status).toBe(200);
        expect(foundTestGroup(response)).toBe(true);
    });

    test('5. characteristic=age-group', async () => {
        const response = await searchGroups({ characteristic: 'age-group' });
        expect(response.status).toBe(200);
        expect(foundTestGroup(response)).toBe(true);
    });

    test('6. characteristic-value (composite)', async () => {
        // Format: characteristic-value=<characteristic-code>$<value-code>
        // Asserts only that the composite parameter is accepted and returns a Bundle, matching
        // the original suite: composite matching behavior is not pinned here either way.
        const response = await searchGroups({ 'characteristic-value': 'age-group$adult' });
        expect(response.status).toBe(200);
        expect(response.body.resourceType).toBe('Bundle');
    });

    test('7. exclude=true', async () => {
        const response = await searchGroups({ exclude: 'true' });
        expect(response.status).toBe(200);
        expect(foundTestGroup(response)).toBe(true);
    });

    test('8. managing-entity=Organization/test-org', async () => {
        const response = await searchGroups({ 'managing-entity': 'Organization/test-org' });
        expect(response.status).toBe(200);
        expect(foundTestGroup(response)).toBe(true);
    });

    test('9. value=adult', async () => {
        const response = await searchGroups({ value: 'adult' });
        expect(response.status).toBe(200);
        expect(foundTestGroup(response)).toBe(true);
    });

    // ============ PARAMETER RESOLVING AGAINST THE ROSTER ============

    test('10. member=Patient/2', async () => {
        const response = await searchGroups({ member: 'Patient/2' });
        expect(response.status).toBe(200);
        expect(foundTestGroup(response)).toBe(true);
    });

    test('10b. member=Patient/never-added does not match', async () => {
        const response = await searchGroups({ member: 'Patient/never-added' });
        expect(response.status).toBe(200);
        expect(foundTestGroup(response)).toBe(false);
    });

    test('10c. member:Patient.identifier chained search finds the Group', async () => {
        // Chained search into Patient.identifier is a supported chain, resolved by
        // ChainedSearchQueryRewriter into a member reference predicate, so it lands on the same
        // filter parameter 10 uses. Asserted positively: a negative assertion here would pass
        // whether the chain resolved correctly or the filter was silently dropped.
        const response = await searchGroups({
            'member:Patient.identifier': `${CHAINED_PATIENT_IDENTIFIER_SYSTEM}|${CHAINED_PATIENT_IDENTIFIER_VALUE}`
        });
        expect(response.status).toBe(200);
        expect(foundTestGroup(response)).toBe(true);
    });
});
