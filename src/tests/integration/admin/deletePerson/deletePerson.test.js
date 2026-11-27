const originalWritePipelineOperations = process.env.WRITE_PIPELINE_OPERATIONS;
process.env.WRITE_PIPELINE_OPERATIONS = 'merge,create,update,patch,admin';

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersWithScopeAndGroups,
    createTestRequest,
    getTestContainer
} = require('../../common');
const { generateUUIDv5 } = require('../../../../utils/uid.util');
const { describe, beforeEach, afterEach, afterAll, test, expect } = require('@jest/globals');

/**
 * Returns the security tags of a Person in the tenant.
 * @param {string} tenant
 * @returns {Object}
 */
const tenantMeta = (tenant) => ({
    source: `https://example.com/admin-tests/${tenant}`,
    security: [
        { system: 'https://www.icanbwell.com/owner', code: tenant },
        { system: 'https://www.icanbwell.com/access', code: tenant }
    ]
});

const CHILD_UUID = generateUUIDv5('admin-delete-child|tenant-a');
const PARENT_UUID = generateUUIDv5('admin-delete-parent|tenant-a');
const OTHER_TENANT_PARENT_UUID = generateUUIDv5('admin-delete-other-tenant-parent|tenant-b');
const MISSING_PERSON_ID = 'admin-delete-missing';

/**
 * The Person that is deleted.
 */
const childPerson = {
    resourceType: 'Person',
    id: 'admin-delete-child',
    meta: tenantMeta('tenant-a'),
    name: [{ family: 'Synthetic', given: ['Child'] }]
};

/**
 * Returns a Person in the tenant that links to the target Person and to a Patient that stays
 * linked.
 * @param {string} id
 * @param {string} tenant
 * @param {string} targetReference
 * @returns {Object}
 */
const parentPersonOf = (id, tenant, targetReference) => ({
    resourceType: 'Person',
    id,
    meta: tenantMeta(tenant),
    name: [{ family: 'Synthetic', given: ['Parent'] }],
    link: [
        { target: { reference: targetReference } },
        { target: { reference: `Patient/admin-delete-patient|${tenant}` } }
    ]
});

/**
 * A Person that links to the deleted Person by its `_uuid`.
 */
const parentPerson = parentPersonOf('admin-delete-parent', 'tenant-a', `Person/${CHILD_UUID}`);

/**
 * The admin token: every admin letter, with write access to `tenant-a` only.
 */
const ADMIN_SCOPE = 'user/*.* access/tenant-a.* admin/*.*';

/**
 * Reads the stored Person with the `_uuid` straight from MongoDB, or null.
 */
const readStoredPersonAsync = async (uuid) => {
    const db = await getTestContainer().mongoDatabaseManager.getDatabaseForResourceAsync({
        resourceType: 'Person'
    });
    return db.collection('Person_4_0_0').findOne({ _uuid: uuid }, { projection: { _id: 0 } });
};

/**
 * Creates the Persons through `$merge` and waits for their post-request work.
 * @param {import('supertest').SuperTest} request
 * @param {Object[]} persons
 */
const createPersonsAsync = async (request, persons) => {
    for (const person of persons) {
        const response = await request
            .post('/4_0_0/Person/$merge')
            .send(person)
            .set(getHeaders());
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ created: true });
    }
    await getTestContainer().postRequestProcessor.waitTillAllRequestsDoneAsync({
        timeoutInSeconds: 20
    });
};

/**
 * Calls `deletePerson` with the admin token and waits for its post-request work.
 * @param {import('supertest').SuperTest} request
 * @param {string} personId
 * @returns {Promise<import('supertest').Response>}
 */
const deletePersonAsync = async (request, personId) => {
    const result = await request
        .delete(`/admin/deletePerson?personId=${personId}`)
        .set(getHeadersWithScopeAndGroups({ scope: ADMIN_SCOPE }));
    await getTestContainer().postRequestProcessor.waitTillAllRequestsDoneAsync({
        timeoutInSeconds: 20
    });
    return result;
};

/**
 * Asserts the stored parent Person lost its link to the deleted Person in a new version and kept
 * its link to the Patient.
 * @param {string} uuid
 * @param {string} tenant
 */
const expectLinkRemovedAsync = async (uuid, tenant) => {
    const parent = await readStoredPersonAsync(uuid);
    expect(parent.meta.versionId).toBe('2');
    expect(parent.link.map((link) => link.target.reference)).toEqual([
        `Patient/admin-delete-patient|${tenant}`
    ]);
};

describe('deletePerson', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    afterAll(() => {
        if (originalWritePipelineOperations === undefined) {
            delete process.env.WRITE_PIPELINE_OPERATIONS;
        } else {
            process.env.WRITE_PIPELINE_OPERATIONS = originalWritePipelineOperations;
        }
    });

    test('removes the link of the Person that links to it by its id, keeps its other links and deletes the Person', async () => {
        const request = await createTestRequest();
        await createPersonsAsync(request, [childPerson, parentPerson]);

        const result = await deletePersonAsync(request, CHILD_UUID);

        expect(result.status).toBe(200);
        expect(result.body).toEqual({
            deletedCount: 1,
            error: null,
            linksRemoved: [
                {
                    message: `Removed link from Person/${parentPerson.id} to Person/${CHILD_UUID}`,
                    bwellPersonId: parentPerson.id,
                    externalPersonId: CHILD_UUID
                }
            ]
        });
        await expectLinkRemovedAsync(PARENT_UUID, 'tenant-a');
        expect(await readStoredPersonAsync(CHILD_UUID)).toBeNull();
    });

    test('given a non-uuid id of a Person that is not stored, removes the links of the Persons that still link to it and deletes nothing', async () => {
        const request = await createTestRequest();
        const parents = [
            parentPersonOf('admin-delete-dangling-1', 'tenant-a', `Person/${MISSING_PERSON_ID}`),
            parentPersonOf('admin-delete-dangling-2', 'tenant-a', `Person/${MISSING_PERSON_ID}`)
        ];
        await createPersonsAsync(request, parents);

        const result = await deletePersonAsync(request, MISSING_PERSON_ID);

        expect(result.status).toBe(200);
        expect(result.body).toEqual({ deletedCount: 0 });
        for (const parent of parents) {
            await expectLinkRemovedAsync(generateUUIDv5(`${parent.id}|tenant-a`), 'tenant-a');
        }
    });

    test('removes the link of a Person in a tenant the admin token has no access to', async () => {
        const request = await createTestRequest();
        const otherTenantParent = parentPersonOf(
            'admin-delete-other-tenant-parent',
            'tenant-b',
            `Person/${CHILD_UUID}`
        );
        await createPersonsAsync(request, [childPerson, otherTenantParent]);

        const result = await deletePersonAsync(request, CHILD_UUID);

        expect(result.status).toBe(200);
        expect(result.body).toEqual({
            deletedCount: 1,
            error: null,
            linksRemoved: [
                {
                    message: `Removed link from Person/${otherTenantParent.id} to Person/${CHILD_UUID}`,
                    bwellPersonId: otherTenantParent.id,
                    externalPersonId: CHILD_UUID
                }
            ]
        });
        await expectLinkRemovedAsync(OTHER_TENANT_PARENT_UUID, 'tenant-b');
        expect(await readStoredPersonAsync(CHILD_UUID)).toBeNull();
    });
});
