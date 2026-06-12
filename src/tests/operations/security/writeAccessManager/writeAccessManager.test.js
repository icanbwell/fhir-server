const {
    describe,
    beforeEach,
    afterEach,
    test,
    expect
} = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../../common');
const { AUTH_USER_TYPES } = require('../../../../constants');
const { FhirRequestInfo } = require('../../../../utils/fhirRequestInfo');
const { WriteAccessManager } = require('../../../../operations/security/writeAccessManager');

const observationMentalHealth = require('./fixtures/Observation/observationMentalHealth.json');
const observationHivAids = require('./fixtures/Observation/observationHivAids.json');
const observationUnclassified = require('./fixtures/Observation/observationUnclassified.json');
const observationMultipleSensitive = require('./fixtures/Observation/observationMultipleSensitive.json');
const observationUnclassifiedAndSensitive = require('./fixtures/Observation/observationUnclassifiedAndSensitive.json');

const PERSON_ID = 'd5ad4ef0-1a68-4e8c-9871-819cdfa25da9';
const ACTOR_ID = 'fc2b3779-1db9-4780-bea1-73dc941b02a7';
// Sensitive-category codes use the b.well vocabulary (UPPER_SNAKE), e.g. MENTAL_HEALTH.
const DENIED_CATEGORY = 'MENTAL_HEALTH'; // denied by the test consent; tagged on the mental-health, multi, and combo fixtures
const NON_DENIED_CATEGORY = 'HIV_AIDS'; // sensitive, but not the denied category in most cases
const UNRELATED_DENIED_CATEGORY = 'DOMESTIC_VIOLENCE'; // denied, but absent from every fixture's tags

/**
 * Build a real FhirRequestInfo instance for the given user type and actor.
 */
function makeRequestInfo (userType, actor) {
    return new FhirRequestInfo({
        user: 'test-user',
        scope: 'patient/*.read patient/*.write',
        remoteIpAddress: '127.0.0.1',
        requestId: 'req-1',
        userRequestId: 'req-1',
        protocol: 'https',
        originalUrl: '/4_0_0/Observation',
        path: '/4_0_0/Observation',
        host: 'localhost',
        body: null,
        accept: 'application/fhir+json',
        isUser: true,
        userType,
        personIdFromJwtToken: PERSON_ID,
        masterPersonIdFromJwtToken: null,
        managingOrganizationId: null,
        headers: {},
        method: 'POST',
        contentTypeFromHeader: null,
        alternateUserId: null,
        actor,
        purposeOfUse: null
    });
}


function delegatedActor (filteringRules) {
    return { sub: 'actor-sub', reference: `RelatedPerson/${ACTOR_ID}`, _filteringRules: filteringRules };
}

function delegatedRequestInfo (filteringRules) {
    return makeRequestInfo(AUTH_USER_TYPES.delegatedUser, delegatedActor(filteringRules));
}

describe('WriteAccessManager', () => {
    beforeEach(async () => {
        await commonBeforeEach();
        mockHttpContext();
        await createTestRequest();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('resolves from the container as a WriteAccessManager', async () => {
        const writeAccessManager = getTestContainer().writeAccessManager;
        expect(writeAccessManager).toBeInstanceOf(WriteAccessManager);
    });

    test('allows a non-delegated user (check does not apply)', async () => {
        const writeAccessManager = getTestContainer().writeAccessManager;
        await expect(
            writeAccessManager.checkAsync({
                requestInfo: makeRequestInfo('patient', null),
                resource: observationMentalHealth,
                base_version: '4_0_0'
            })
        ).resolves.toBe(true);
    });

    test('denies a delegated user with no valid consent', async () => {
        const writeAccessManager = getTestContainer().writeAccessManager;
        await expect(
            writeAccessManager.checkAsync({
                requestInfo: delegatedRequestInfo(null),
                resource: observationMentalHealth,
                base_version: '4_0_0'
            })
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    test('allows a delegated user whose consent denies no categories', async () => {
        const writeAccessManager = getTestContainer().writeAccessManager;
        await expect(
            writeAccessManager.checkAsync({
                requestInfo: delegatedRequestInfo({ deniedSensitiveCategories: [] }),
                resource: observationMentalHealth,
                base_version: '4_0_0'
            })
        ).resolves.toBe(true);
    });

    test('denies writing a resource in a denied sensitive category', async () => {
        const writeAccessManager = getTestContainer().writeAccessManager;
        await expect(
            writeAccessManager.checkAsync({
                requestInfo: delegatedRequestInfo({ deniedSensitiveCategories: [DENIED_CATEGORY] }),
                resource: observationMentalHealth,
                base_version: '4_0_0'
            })
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    test('allows writing a resource in a non-denied sensitive category', async () => {
        const writeAccessManager = getTestContainer().writeAccessManager;
        await expect(
            writeAccessManager.checkAsync({
                requestInfo: delegatedRequestInfo({ deniedSensitiveCategories: [DENIED_CATEGORY] }),
                resource: observationHivAids,
                base_version: '4_0_0'
            })
        ).resolves.toBe(true);
    });

    test('allows writing a resource tagged unclassified', async () => {
        const writeAccessManager = getTestContainer().writeAccessManager;
        await expect(
            writeAccessManager.checkAsync({
                requestInfo: delegatedRequestInfo({ deniedSensitiveCategories: [DENIED_CATEGORY] }),
                resource: observationUnclassified,
                base_version: '4_0_0'
            })
        ).resolves.toBe(true);
    });

    // Multiple sensitivity tags: the resource carries MENTAL_HEALTH and HIV_AIDS.
    // checkAsync denies if ANY tag is in the denied set (Array.some over meta.security).
    test('denies writing a resource when one of several sensitivity tags is denied', async () => {
        const writeAccessManager = getTestContainer().writeAccessManager;
        await expect(
            writeAccessManager.checkAsync({
                requestInfo: delegatedRequestInfo({ deniedSensitiveCategories: [DENIED_CATEGORY] }),
                resource: observationMultipleSensitive,
                base_version: '4_0_0'
            })
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    test('allows writing a multi-tagged resource when none of its sensitivity tags are denied', async () => {
        const writeAccessManager = getTestContainer().writeAccessManager;
        await expect(
            writeAccessManager.checkAsync({
                requestInfo: delegatedRequestInfo({ deniedSensitiveCategories: [UNRELATED_DENIED_CATEGORY] }),
                resource: observationMultipleSensitive,
                base_version: '4_0_0'
            })
        ).resolves.toBe(true);
    });

    // Combined tags: the resource carries both `unclassified` and a sensitive category.
    // The unclassified tag must NOT rescue a resource that also carries a denied category.
    test('denies writing a resource tagged unclassified plus a denied sensitive category', async () => {
        const writeAccessManager = getTestContainer().writeAccessManager;
        await expect(
            writeAccessManager.checkAsync({
                requestInfo: delegatedRequestInfo({ deniedSensitiveCategories: [DENIED_CATEGORY] }),
                resource: observationUnclassifiedAndSensitive,
                base_version: '4_0_0'
            })
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    test('allows writing a resource tagged unclassified plus a non-denied sensitive category', async () => {
        const writeAccessManager = getTestContainer().writeAccessManager;
        await expect(
            writeAccessManager.checkAsync({
                requestInfo: delegatedRequestInfo({ deniedSensitiveCategories: [NON_DENIED_CATEGORY] }),
                resource: observationUnclassifiedAndSensitive,
                base_version: '4_0_0'
            })
        ).resolves.toBe(true);
    });
});
