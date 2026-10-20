/**
 * `DELETE /Group?member=X` for extended Groups (DCON-5910)
 *
 * GroupMemberQueryRewriter is registered for DELETE as well as READ, so a conditional delete by
 * member matches the same Groups `GET /Group?member=X` returns, extended ones included. Each matched
 * Group then goes through RemoveOperation unchanged: the per-Group write check, the DCON-5655
 * member cascade for a single extended Group, and the rejection of a delete that matches more than
 * one extended Group (400 too-costly, nothing deleted).
 *
 * ENABLE_EXTENDED_GROUP is off by default in jest; it is turned on for each test here.
 */
const { describe, test, beforeEach, afterEach, expect, jest } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders,
    getHeadersJsonPatch,
    getHeadersWithCustomPayload,
    mockHttpContext
} = require('../common');
const {
    GROUP_MEMBER_COLLECTION_NAME,
    GROUP_MEMBER_HISTORY_COLLECTION_NAME,
    OPERATIONS: { READ, DELETE }
} = require('../../../constants');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../utils/mongoGroupExtendedTag');
const { GroupMemberQueryRewriter } = require('../../../queryRewriters/rewriters/groupMemberQueryRewriter');
const { PatientProxyQueryRewriter } = require('../../../queryRewriters/rewriters/patientProxyQueryRewriter');

const GROUP_COLLECTION_NAME = 'Group_4_0_0';

describe('Group conditional delete by member (extended storage)', () => {
    let request;
    let requestId;
    let originalEnableExtendedGroup;

    beforeEach(async () => {
        originalEnableExtendedGroup = process.env.ENABLE_EXTENDED_GROUP;
        process.env.ENABLE_EXTENDED_GROUP = '1';
        await commonBeforeEach();
        requestId = mockHttpContext();
        request = await createTestRequest();
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        // Drop the per-test own-property override so the prototype getter (env-backed) applies again.
        delete getTestContainer().configManager.enableExtendedGroup;
        await commonAfterEach();
        if (originalEnableExtendedGroup === undefined) {
            delete process.env.ENABLE_EXTENDED_GROUP;
        } else {
            process.env.ENABLE_EXTENDED_GROUP = originalEnableExtendedGroup;
        }
    });

    /**
     * A write (delete included) needs an access/ scope matching both the owner and the access tag,
     * so tenant-scoped Groups carry the tenant code in both.
     */
    function defaultMeta(accessCode = 'test-access', ownerCode = 'test-owner') {
        return {
            source: 'http://test-system.com/Group',
            security: [
                { system: 'https://www.icanbwell.com/owner', code: ownerCode },
                { system: 'https://www.icanbwell.com/access', code: accessCode }
            ]
        };
    }

    async function getCollection(name) {
        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        return db.collection(name);
    }

    async function createGroup(overrides = {}) {
        const response = await request
            .post('/4_0_0/Group')
            .send({ resourceType: 'Group', type: 'person', actual: true, meta: defaultMeta(), ...overrides })
            .set(getHeaders());
        expect(response.status).toBe(201);
        return response.body;
    }

    /** Raw write of the internal marker field, the same way the other extended Group tests do. */
    async function markGroupExtended(groupId) {
        const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
        await groupCollection.updateOne({ id: groupId }, { $set: { [MONGO_GROUP_EXTENDED_FIELD]: true } });
    }

    async function addExtendedMember(groupId, reference) {
        const response = await request
            .patch(`/4_0_0/Group/${groupId}`)
            .send([{ op: 'add', path: '/member/-', value: { entity: { reference } } }])
            .set(getHeadersJsonPatch());
        expect(response.status).toBe(200);
    }

    async function createExtendedGroup(references, overrides = {}) {
        const group = await createGroup(overrides);
        await markGroupExtended(group.id);
        for (const reference of references) {
            await addExtendedMember(group.id, reference);
        }
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId });
        return group;
    }

    async function createEmbeddedGroup(references, overrides = {}) {
        return await createGroup({ member: references.map((reference) => ({ entity: { reference } })), ...overrides });
    }

    /** Conditional (search-based) delete: 200 with `{ deleted: <count> }`, unlike DELETE /Group/{id} (204). */
    async function deleteBySearch(queryString, headers = getHeaders()) {
        const response = await request.delete(`/4_0_0/Group?${queryString}`).set(headers);
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId });
        return response;
    }

    async function deleteByMember(reference, headers = getHeaders()) {
        return await deleteBySearch(`member=${encodeURIComponent(reference)}`, headers);
    }

    async function deleteById(groupId) {
        const response = await request.delete(`/4_0_0/Group/${groupId}`).set(getHeaders());
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId });
        return response;
    }

    async function groupDoc(groupId) {
        const groupCollection = await getCollection(GROUP_COLLECTION_NAME);
        return await groupCollection.findOne({ id: groupId });
    }

    async function groupExists(groupId) {
        return (await groupDoc(groupId)) !== null;
    }

    async function liveMemberCount(groupUuid) {
        const memberCollection = await getCollection(GROUP_MEMBER_COLLECTION_NAME);
        return await memberCollection.countDocuments({ groupUuid });
    }

    async function memberTombstoneCount(groupUuid) {
        const historyCollection = await getCollection(GROUP_MEMBER_HISTORY_COLLECTION_NAME);
        return await historyCollection.countDocuments({
            'resource.groupUuid': groupUuid,
            'request.method': 'DELETE'
        });
    }

    function setExtendedGroupEnabled(value) {
        Object.defineProperty(getTestContainer().configManager, 'enableExtendedGroup', {
            get: () => value, configurable: true
        });
    }

    test('DELETE rewriters hold only GroupMemberQueryRewriter, shared with READ; READ list unchanged', () => {
        const { queryRewriterManager } = getTestContainer();
        const deleteRewriters = queryRewriterManager.operationSpecificQueryRewriters[`${DELETE}`];
        const readRewriters = queryRewriterManager.operationSpecificQueryRewriters[`${READ}`];

        expect(deleteRewriters).toHaveLength(1);
        expect(deleteRewriters[0]).toBeInstanceOf(GroupMemberQueryRewriter);
        expect(readRewriters).toContain(deleteRewriters[0]);
        expect(readRewriters.some((rewriter) => rewriter instanceof PatientProxyQueryRewriter)).toBe(true);
        expect(deleteRewriters.some((rewriter) => rewriter instanceof PatientProxyQueryRewriter)).toBe(false);
    });

    test('embedded only: deletes the matching embedded Group and nothing else', async () => {
        const matching = await createEmbeddedGroup(['Patient/emb-1']);
        const other = await createEmbeddedGroup(['Patient/emb-2']);

        const response = await deleteByMember('Patient/emb-1');

        expect(response.status).toBe(200);
        expect(response.body.deleted).toBe(1);
        expect(await groupExists(matching.id)).toBe(false);
        expect(await groupExists(other.id)).toBe(true);
    });

    test('single extended Group: deleted, its member rows removed and tombstoned', async () => {
        const extended = await createExtendedGroup(['Patient/ext-1', 'Patient/ext-2']);
        const groupUuid = (await groupDoc(extended.id))._uuid;
        expect(await liveMemberCount(groupUuid)).toBe(2);

        const response = await deleteByMember('Patient/ext-1');

        expect(response.status).toBe(200);
        expect(response.body.deleted).toBe(1);
        expect(await groupExists(extended.id)).toBe(false);
        expect(await liveMemberCount(groupUuid)).toBe(0);
        expect(await memberTombstoneCount(groupUuid)).toBe(2);
    });

    test('embedded + one extended holding the same member: both deleted', async () => {
        const embedded = await createEmbeddedGroup(['Patient/mixed-1']);
        const extended = await createExtendedGroup(['Patient/mixed-1']);
        const groupUuid = (await groupDoc(extended.id))._uuid;

        const response = await deleteByMember('Patient/mixed-1');

        expect(response.status).toBe(200);
        expect(response.body.deleted).toBe(2);
        expect(await groupExists(embedded.id)).toBe(false);
        expect(await groupExists(extended.id)).toBe(false);
        expect(await liveMemberCount(groupUuid)).toBe(0);
    });

    test('two extended Groups, member in only one: only that one is deleted', async () => {
        const holding = await createExtendedGroup(['Patient/only-in-one']);
        const notHolding = await createExtendedGroup(['Patient/someone-else']);
        const notHoldingUuid = (await groupDoc(notHolding.id))._uuid;

        const response = await deleteByMember('Patient/only-in-one');

        expect(response.status).toBe(200);
        expect(response.body.deleted).toBe(1);
        expect(await groupExists(holding.id)).toBe(false);
        expect(await groupExists(notHolding.id)).toBe(true);
        expect(await liveMemberCount(notHoldingUuid)).toBe(1);
    });

    test('flag off: the extended Group holding the member is not deleted, the embedded one is', async () => {
        const embedded = await createEmbeddedGroup(['Patient/flag-off']);
        const extended = await createExtendedGroup(['Patient/flag-off']);
        const groupUuid = (await groupDoc(extended.id))._uuid;
        setExtendedGroupEnabled(false);

        const response = await deleteByMember('Patient/flag-off');

        expect(response.status).toBe(200);
        expect(response.body.deleted).toBe(1);
        expect(await groupExists(embedded.id)).toBe(false);
        expect(await groupExists(extended.id)).toBe(true);
        expect(await liveMemberCount(groupUuid)).toBe(1);
    });

    test('member:not=Y deletes the extended Group without Y and keeps the one holding Y', async () => {
        const holdingY = await createExtendedGroup(['Patient/not-y']);
        const withoutY = await createExtendedGroup(['Patient/not-other']);
        const holdingYUuid = (await groupDoc(holdingY.id))._uuid;

        const response = await deleteBySearch(`member:not=${encodeURIComponent('Patient/not-y')}`);

        expect(response.status).toBe(200);
        expect(response.body.deleted).toBe(1);
        expect(await groupExists(withoutY.id)).toBe(false);
        expect(await groupExists(holdingY.id)).toBe(true);
        expect(await liveMemberCount(holdingYUuid)).toBe(1);
    });

    test('embedded + two extended holding X: whole request rejected and nothing deleted; deleting the extended Groups by id first lets a retry succeed', async () => {
        const embedded = await createEmbeddedGroup(['Patient/costly']);
        const firstExtended = await createExtendedGroup(['Patient/costly', 'Patient/costly-a']);
        const secondExtended = await createExtendedGroup(['Patient/costly']);
        const firstUuid = (await groupDoc(firstExtended.id))._uuid;
        const secondUuid = (await groupDoc(secondExtended.id))._uuid;

        const rejected = await deleteByMember('Patient/costly');

        expect(rejected.status).toBe(400);
        expect(rejected.body.resourceType).toBe('OperationOutcome');
        expect(rejected.body.issue[0].code).toBe('too-costly');
        expect(await groupExists(embedded.id)).toBe(true);
        expect(await groupExists(firstExtended.id)).toBe(true);
        expect(await groupExists(secondExtended.id)).toBe(true);
        expect(await liveMemberCount(firstUuid)).toBe(2);
        expect(await liveMemberCount(secondUuid)).toBe(1);
        expect(await memberTombstoneCount(firstUuid)).toBe(0);
        expect(await memberTombstoneCount(secondUuid)).toBe(0);

        expect((await deleteById(firstExtended.id)).status).toBe(204);
        expect((await deleteById(secondExtended.id)).status).toBe(204);
        expect(await liveMemberCount(firstUuid)).toBe(0);
        expect(await liveMemberCount(secondUuid)).toBe(0);

        const retried = await deleteByMember('Patient/costly');

        expect(retried.status).toBe(200);
        expect(retried.body.deleted).toBe(1);
        expect(await groupExists(embedded.id)).toBe(false);
    });

    test('tenant isolation: an other-tenant extended Group holding X is neither deleted nor counted toward too-costly', async () => {
        // Created with full-access headers; only the delete uses tenant-restricted scopes.
        const tenantA = await createExtendedGroup(['Patient/cross-tenant'], { meta: defaultMeta('tenant-a', 'tenant-a') });
        const tenantB = await createExtendedGroup(['Patient/cross-tenant'], { meta: defaultMeta('tenant-b', 'tenant-b') });
        const tenantBUuid = (await groupDoc(tenantB.id))._uuid;

        const response = await deleteByMember('Patient/cross-tenant', getHeaders('user/*.* access/tenant-a.*'));

        expect(response.status).toBe(200);
        expect(response.body.deleted).toBe(1);
        expect(await groupExists(tenantA.id)).toBe(false);
        expect(await groupExists(tenantB.id)).toBe(true);
        expect(await liveMemberCount(tenantBUuid)).toBe(1);
    });

    test('read-only access tag: an extended Group the caller can only read is excluded from the delete query and not counted toward too-costly', async () => {
        const writable = await createExtendedGroup(['Patient/ro-member'], { meta: defaultMeta('tenant-a', 'tenant-a') });
        const readOnly = await createExtendedGroup(['Patient/ro-member'], { meta: defaultMeta('tenant-ro', 'tenant-ro') });
        const readOnlyUuid = (await groupDoc(readOnly.id))._uuid;

        const response = await deleteByMember(
            'Patient/ro-member',
            getHeaders('user/*.* access/tenant-a.* access/tenant-ro.read')
        );

        expect(response.status).toBe(200);
        expect(response.body.deleted).toBe(1);
        expect(await groupExists(writable.id)).toBe(false);
        expect(await groupExists(readOnly.id)).toBe(true);
        expect(await liveMemberCount(readOnlyUuid)).toBe(1);
    });

    test('patient-scoped token: extended Groups containing the caller\'s patient are not deleted and do not trigger too-costly', async () => {
        const meta = { source: 'http://test-system.com/Patient', security: defaultMeta().security };
        const patientResp = await request.put('/4_0_0/Patient/del-scope-patient')
            .send({ resourceType: 'Patient', id: 'del-scope-patient', meta })
            .set(getHeaders());
        expect(patientResp.status).toBeLessThan(300);
        const personResp = await request.put('/4_0_0/Person/del-scope-person')
            .send({
                resourceType: 'Person',
                id: 'del-scope-person',
                meta: { ...meta, source: 'http://test-system.com/Person' },
                link: [{ target: { reference: 'Patient/del-scope-patient' } }]
            })
            .set(getHeaders());
        expect(personResp.status).toBeLessThan(300);

        const clientDb = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        const personUuid = (await clientDb.collection('Person_4_0_0').findOne({ id: 'del-scope-person' }))._uuid;
        const patientUuid = (await clientDb.collection('Patient_4_0_0').findOne({ id: 'del-scope-patient' }))._uuid;

        const embedded = await createEmbeddedGroup(['Patient/del-scope-patient']);
        const firstExtended = await createExtendedGroup(['Patient/del-scope-patient']);
        const secondExtended = await createExtendedGroup(['Patient/del-scope-patient']);
        const firstUuid = (await groupDoc(firstExtended.id))._uuid;
        const secondUuid = (await groupDoc(secondExtended.id))._uuid;

        const response = await deleteByMember('Patient/del-scope-patient', getHeadersWithCustomPayload({
            scope: 'patient/*.* user/*.* access/*.*',
            username: 'patient-scope-user',
            client_id: 'client',
            clientFhirPersonId: personUuid,
            clientFhirPatientId: patientUuid,
            bwellFhirPersonId: personUuid,
            bwellFhirPatientId: patientUuid,
            token_use: 'access'
        }));

        // The patient may delete the embedded Group; both extended Groups match the widened patient
        // filter but fail canWriteResourceAsync (no inline member[]), so they are skipped before the
        // more-than-one-extended check.
        expect(response.status).toBe(200);
        expect(response.body.deleted).toBe(1);
        expect(await groupExists(embedded.id)).toBe(false);
        expect(await groupExists(firstExtended.id)).toBe(true);
        expect(await groupExists(secondExtended.id)).toBe(true);
        expect(await liveMemberCount(firstUuid)).toBe(1);
        expect(await liveMemberCount(secondUuid)).toBe(1);
    });
});
