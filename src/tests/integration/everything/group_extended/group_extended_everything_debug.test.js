/**
 * DCON-5657: $everything _debug lists the GroupMember_4_0_0 lookup the Group query was built from
 * (GroupMemberQueryRewriter), like search does. Compared against expected fixtures, as the other
 * $everything _debug tests are.
 *
 * ENABLE_EXTENDED_GROUP is turned on for the suite's tests (off by default in jest).
 */
const personResource = require('./fixtures/Person/person1.json');
const patientResource = require('./fixtures/Patient/patient1.json');
const embeddedGroupResource = require('./fixtures/Group/group_embedded.json');
const extendedGroupResource = require('./fixtures/Group/group_extended.json');

const expectedPatientEverything = require('./fixtures/expected/expected_patient_everything_debug.json');
const expectedPersonEverything = require('./fixtures/expected/expected_person_everything_debug.json');
const expectedPatientEverythingFlagOff = require('./fixtures/expected/expected_patient_everything_debug_flag_off.json');

const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders,
    getHeadersWithAdmin,
    getHeadersJsonPatch
} = require('../../common');

const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../../utils/mongoGroupExtendedTag');

const PATIENT_ID = patientResource.id;
const PERSON_ID = personResource.id;

describe('$everything _debug with an extended Group', () => {
    let request;
    let originalEnableExtendedGroup;

    beforeEach(async () => {
        originalEnableExtendedGroup = process.env.ENABLE_EXTENDED_GROUP;
        process.env.ENABLE_EXTENDED_GROUP = '1';
        await commonBeforeEach();
        request = await createTestRequest();

        const merge = await request
            .post('/4_0_0/Person/1/$merge')
            .send([personResource, patientResource, embeddedGroupResource, extendedGroupResource])
            .set(getHeaders());
        expect(merge).toHaveMergeResponse([{ created: true }, { created: true }, { created: true }, { created: true }]);

        // promote the Group to extended, then add its roster row through PATCH
        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        await db.collection('Group_4_0_0').updateOne(
            { id: extendedGroupResource.id },
            { $set: { [MONGO_GROUP_EXTENDED_FIELD]: true } }
        );
        const patch = await request
            .patch(`/4_0_0/Group/${extendedGroupResource.id}`)
            .send([{ op: 'add', path: '/member/-', value: { entity: { reference: `Patient/${PATIENT_ID}|test-owner` } } }])
            .set(getHeadersJsonPatch());
        expect(patch.status).toBe(200);
    });

    afterEach(async () => {
        await commonAfterEach();
        process.env.ENABLE_EXTENDED_GROUP = originalEnableExtendedGroup;
    });

    test('Patient $everything lists the GroupMember lookup', async () => {
        const resp = await request
            .get(`/4_0_0/Patient/${PATIENT_ID}/$everything?_type=Patient,Group&_debug=1`)
            .set(getHeadersWithAdmin());

        expect(resp).toHaveMongoQuery(expectedPatientEverything);
        expect(resp).toHaveResponse(expectedPatientEverything);
    });

    test('Person $everything lists the GroupMember lookup', async () => {
        const resp = await request
            .get(`/4_0_0/Person/${PERSON_ID}/$everything?_type=Person,Patient,Group&_debug=1`)
            .set(getHeadersWithAdmin());

        expect(resp).toHaveMongoQuery(expectedPersonEverything);
        expect(resp).toHaveResponse(expectedPersonEverything);
    });

    test('with ENABLE_EXTENDED_GROUP off no GroupMember lookup is listed and the extended Group is not returned', async () => {
        const savedEnableExtendedGroup = process.env.ENABLE_EXTENDED_GROUP;
        delete process.env.ENABLE_EXTENDED_GROUP;
        try {
            const resp = await request
                .get(`/4_0_0/Patient/${PATIENT_ID}/$everything?_type=Patient,Group&_debug=1`)
                .set(getHeadersWithAdmin());

            expect(resp).toHaveMongoQuery(expectedPatientEverythingFlagOff);
            expect(resp).toHaveResponse(expectedPatientEverythingFlagOff);
        } finally {
            process.env.ENABLE_EXTENDED_GROUP = savedEnableExtendedGroup;
        }
    });
});
