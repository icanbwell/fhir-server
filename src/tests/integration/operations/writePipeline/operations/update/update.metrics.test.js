const deepcopy = require('deepcopy');

const patientResource = require('./fixtures/patient.json');
const patientByUuidResource = require('./fixtures/patientByUuid.json');
const patientOtherTenantResource = require('./fixtures/patientOtherTenant.json');
const observationResource = require('./fixtures/observation.json');
const personWithoutLinksResource = require('./fixtures/personWithoutLinks.json');
const groupResource = require('./fixtures/group.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer
} = require('../../../../common');
const metrics = require('../../../../../../utils/metrics');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../../../../utils/mongoGroupExtendedTag');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

/**
 * The two write paths each case runs on.
 */
const PATHS = ['old', 'new'];

/**
 * The environment variables a case or a path switch changes, restored after every test.
 */
const ENVIRONMENT_KEYS = [
    'WRITE_PIPELINE_OPERATIONS',
    'ENABLE_EXTENDED_GROUP',
    'GROUP_MEMBER_PROMOTION_LIMIT'
];

/**
 * The environment of a case whose Group must have at most three members.
 */
const GROUP_OVER_LIMIT_ENVIRONMENT = Object.freeze({
    ENABLE_EXTENDED_GROUP: '1',
    GROUP_MEMBER_PROMOTION_LIMIT: '3'
});

/**
 * The headers of a caller with write access to the `client` tenant only.
 */
const clientOnlyHeaders = getHeaders('user/*.* access/client.*');

/**
 * Returns the labels `fhir_validation_failure_total` gets for an error-severity save-time failure
 * of the resource type at the validation stage.
 */
const failureLabels = (resourceType, validationStage) => Object.freeze({
    [metrics.LABEL.RESOURCE_TYPE]: resourceType,
    [metrics.LABEL.VALIDATION_STAGE]: validationStage,
    [metrics.LABEL.SEVERITY]: 'error',
    [metrics.LABEL.PATH]: metrics.PATH.SAVE
});

/**
 * Returns a copy of the resource with the given top-level fields replaced.
 */
const variant = (resource, changes) => ({ ...deepcopy(resource), ...changes });

/**
 * Returns a copy of the resource with its `meta.security` replaced by the given tags.
 */
const withSecurity = (resource, security) =>
    variant(resource, { meta: { ...deepcopy(resource.meta), security } });

/**
 * Returns an access tag for the given client code.
 */
const accessTag = (code) => ({ system: 'https://www.icanbwell.com/access', code });

/**
 * Returns an owner tag for the given client code.
 */
const ownerTag = (code) => ({ system: 'https://www.icanbwell.com/owner', code });

/**
 * Returns the given number of Group members pointing at synthetic patients.
 */
const groupMembers = (count) =>
    Array.from({ length: count }, (_, index) => ({
        entity: { reference: `Patient/put-metrics-member-${index}` }
    }));

/**
 * Sets `_extended` on the stored Group, the way the extended Group tests mark one.
 */
const markGroupExtended = async () => {
    const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
    await db
        .collection('Group_4_0_0')
        .updateOne({ id: groupResource.id }, { $set: { [MONGO_GROUP_EXTENDED_FIELD]: true } });
};

/**
 * Returns the stored Patient with a second access tag, which a caller who may write to the
 * `client` tenant only is not allowed to remove.
 */
const patientWithTwoAccessTags = () =>
    withSecurity(patientResource, [
        accessTag('client'),
        accessTag('other-client'),
        ownerTag('client')
    ]);

/**
 * Returns a Person that links to the Patient of the other tenant.
 */
const personLinkedToOtherTenant = () =>
    variant(personWithoutLinksResource, {
        link: [{ target: { reference: `Patient/${patientOtherTenantResource.id}` } }]
    });

/**
 * Sends PUT to the new write pipeline or the old path by setting `WRITE_PIPELINE_OPERATIONS`.
 */
const useWritePath = (path) => {
    process.env.WRITE_PIPELINE_OPERATIONS = path === 'new' ? 'update' : '';
};

/**
 * Expands each case into one run per path.
 */
const withEachPath = (cases) =>
    cases.flatMap((testCase) => PATHS.map((path) => ({ ...testCase, path })));

/**
 * Returns the value a case has on the given path: its `byPath` entry for that path when it has
 * one, else `shared`.
 */
const valueFor = ({ shared, byPath, path }) => byPath?.[path] ?? shared;

/**
 * Stores a resource that a case needs to exist already, through `$merge` on the old path.
 */
const storeResource = (request, resource) =>
    request.post(`/4_0_0/${resource.resourceType}/$merge`).send(resource).set(getHeaders());

describe('PUT validation failure metric on the old and the new write path', () => {
    const originalEnvironment = Object.fromEntries(
        ENVIRONMENT_KEYS.map((key) => [key, process.env[key]])
    );
    let validationFailureAddSpy;

    beforeEach(async () => {
        await commonBeforeEach();
        validationFailureAddSpy = jest.spyOn(metrics.validationFailureCounter, 'add');
    });

    afterEach(async () => {
        validationFailureAddSpy.mockRestore();
        for (const [key, value] of Object.entries(originalEnvironment)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
        await commonAfterEach();
    });

    const cases = [
        {
            name: 'invalidSchema',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: variant(patientResource, { birthDate: 'not-a-date' }),
            status: 400,
            labels: [failureLabels('Patient', metrics.VALIDATION_STAGE.SCHEMA)]
        },
        {
            name: 'invalidSchemaOnNew',
            type: 'Patient',
            id: patientResource.id,
            body: variant(patientResource, { birthDate: 'not-a-date' }),
            status: 400,
            labels: [failureLabels('Patient', metrics.VALIDATION_STAGE.SCHEMA)]
        },
        {
            name: 'typeMismatch',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: variant(observationResource, { id: patientResource.id }),
            status: 400,
            labels: [failureLabels('Patient', metrics.VALIDATION_STAGE.SCHEMA)]
        },
        {
            name: 'typeMismatchWithoutScope',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: variant(observationResource, { id: patientResource.id }),
            headers: getHeaders('user/Observation.*'),
            statusByPath: { old: 403, new: 400 },
            labelsByPath: {
                old: [],
                new: [failureLabels('Patient', metrics.VALIDATION_STAGE.SCHEMA)]
            }
        },
        {
            name: 'invalidSchemaStoredNotAccessible',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: variant(patientResource, { birthDate: 'not-a-date' }),
            headers: getHeaders('user/*.* access/other-client.*'),
            statusByPath: { old: 403, new: 400 },
            labelsByPath: {
                old: [],
                new: [failureLabels('Patient', metrics.VALIDATION_STAGE.SCHEMA)]
            }
        },
        {
            name: 'nonUuidIdWithoutAuthorityTag',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: withSecurity(patientResource, [accessTag('client')]),
            status: 400,
            labels: [failureLabels('Patient', metrics.VALIDATION_STAGE.META)]
        },
        {
            name: 'metaMissingOwnerOnCreate',
            type: 'Patient',
            id: patientByUuidResource.id,
            body: withSecurity(patientByUuidResource, [accessTag('client')]),
            status: 400,
            labels: [failureLabels('Patient', metrics.VALIDATION_STAGE.META)]
        },
        {
            name: 'metaNullAccessTagOnUpdate',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: withSecurity(patientResource, [
                ...patientResource.meta.security,
                accessTag('null')
            ]),
            status: 400,
            labels: [failureLabels('Patient', metrics.VALIDATION_STAGE.META)]
        },
        {
            name: 'patientReferenceChanged',
            type: 'Observation',
            id: observationResource.id,
            previous: [observationResource],
            body: variant(observationResource, {
                subject: { reference: 'Patient/parity-patient-2' }
            }),
            status: 400,
            labels: [failureLabels('Observation', metrics.VALIDATION_STAGE.REFERENCE)]
        },
        {
            name: 'personLinkOtherTenant',
            type: 'Person',
            id: personWithoutLinksResource.id,
            previous: [patientOtherTenantResource, personWithoutLinksResource],
            body: personLinkedToOtherTenant(),
            headers: clientOnlyHeaders,
            status: 400,
            labels: [failureLabels('Person', metrics.VALIDATION_STAGE.REFERENCE)]
        },
        {
            name: 'createViaPutPersonLinkOtherTenantAccessDenied',
            type: 'Person',
            id: personWithoutLinksResource.id,
            previous: [patientOtherTenantResource],
            body: withSecurity(personLinkedToOtherTenant(), [
                accessTag('client'),
                accessTag('other-client'),
                ownerTag('client')
            ]),
            headers: clientOnlyHeaders,
            statusByPath: { old: 400, new: 403 },
            labelsByPath: {
                old: [failureLabels('Person', metrics.VALIDATION_STAGE.REFERENCE)],
                new: []
            }
        },
        {
            name: 'ifMatchMismatchPatientReferenceChanged',
            type: 'Observation',
            id: observationResource.id,
            previous: [observationResource],
            body: variant(observationResource, {
                subject: { reference: 'Patient/parity-patient-2' }
            }),
            headers: { ...getHeaders(), 'If-Match': 'W/"7"' },
            status: 400,
            labels: [failureLabels('Observation', metrics.VALIDATION_STAGE.REFERENCE)]
        },
        {
            name: 'accessTagRemoveNotGrantableInvalidReference',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientWithTwoAccessTags()],
            body: variant(patientResource, {
                name: [{ family: 'Parity', given: ['Gamma'] }],
                managingOrganization: { reference: 'not-a-reference' }
            }),
            headers: clientOnlyHeaders,
            statusByPath: { old: 400, new: 403 },
            labelsByPath: {
                old: [failureLabels('Patient', metrics.VALIDATION_STAGE.SCHEMA)],
                new: []
            }
        },
        {
            name: 'extendedGroupWithMembers',
            type: 'Group',
            id: groupResource.id,
            previous: [groupResource],
            afterStore: markGroupExtended,
            body: variant(groupResource, { member: groupMembers(1) }),
            status: 400,
            labels: []
        },
        {
            name: 'groupOverLimit',
            type: 'Group',
            id: groupResource.id,
            previous: [groupResource],
            env: GROUP_OVER_LIMIT_ENVIRONMENT,
            body: variant(groupResource, { member: groupMembers(4) }),
            status: 400,
            labels: []
        },
        {
            name: 'groupOverLimitWithInvalidField',
            type: 'Group',
            id: groupResource.id,
            previous: [groupResource],
            env: GROUP_OVER_LIMIT_ENVIRONMENT,
            body: variant(groupResource, { member: groupMembers(4), notAFhirField: 'x' }),
            status: 400,
            labelsByPath: {
                old: [],
                new: [failureLabels('Group', metrics.VALIDATION_STAGE.SCHEMA)]
            }
        },
        {
            name: 'noOpGroupOverLoweredLimit',
            type: 'Group',
            id: groupResource.id,
            storeEnv: { ENABLE_EXTENDED_GROUP: '1', GROUP_MEMBER_PROMOTION_LIMIT: '10' },
            previous: [variant(groupResource, { member: groupMembers(4) })],
            env: GROUP_OVER_LIMIT_ENVIRONMENT,
            body: variant(groupResource, { member: groupMembers(4) }),
            status: 400,
            labels: []
        },
        {
            name: 'idAuthorityMismatch',
            type: 'Patient',
            id: `${patientResource.id}|other-client`,
            previous: [patientResource],
            body: variant(patientResource, { name: [{ family: 'Parity', given: ['Gamma'] }] }),
            status: 400,
            labels: []
        },
        {
            name: 'ifMatchMismatch',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: variant(patientResource, { name: [{ family: 'Parity', given: ['Gamma'] }] }),
            headers: { ...getHeaders(), 'If-Match': 'W/"7"' },
            status: 412,
            labels: []
        }
    ];

    test.each(withEachPath(cases))('$name on the $path path records exactly its failures', async ({
        path,
        type,
        id,
        storeEnv = {},
        previous = [],
        afterStore,
        env = {},
        body,
        headers = getHeaders(),
        status,
        statusByPath,
        labels,
        labelsByPath
    }) => {
        const request = await createTestRequest();
        useWritePath('old');
        Object.assign(process.env, storeEnv);
        for (const resource of previous) {
            await storeResource(request, resource).expect(200);
        }
        if (afterStore) {
            await afterStore();
        }
        validationFailureAddSpy.mockClear();
        Object.assign(process.env, env);
        useWritePath(path);

        const resp = await request.put(`/4_0_0/${type}/${id}`).send(body).set(headers);

        expect(resp.status).toBe(valueFor({ shared: status, byPath: statusByPath, path }));
        const expectedLabels = valueFor({ shared: labels, byPath: labelsByPath, path });
        expect(validationFailureAddSpy.mock.calls).toStrictEqual(
            expectedLabels.map((expected) => [1, expected])
        );
    });
});
