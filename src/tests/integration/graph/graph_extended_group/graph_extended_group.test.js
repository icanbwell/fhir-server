/**
 * $graph over extended Groups.
 *
 * An extended Group has no inline member[] (its roster lives in GroupMember_4_0_0).
 * - Forward link off a Group (member.entity): resolves to no member entities; the Group node is
 *   still returned, tagged groupSize|extended, and nothing is expanded under it.
 * - Reverse link onto a Group (Patient -> Group, member={ref}): the Group is found through the
 *   roster and attached under each requested Patient that is in it, as an embedded Group is.
 * An embedded Group behaves as before.
 *
 * ENABLE_EXTENDED_GROUP is turned on for the suite's tests (off by default in jest).
 */
const patientResource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');
const embeddedGroupResource = require('./fixtures/Group/group_embedded.json');
const extendedGroupResource = require('./fixtures/Group/group_extended.json');
const extendedBothGroupResource = require('./fixtures/Group/group_extended_both.json');

const graphDefinitionResource = require('./fixtures/graph/group_member_entity_graph.json');
const reverseGraphDefinitionResource = require('./fixtures/graph/patient_groups_graph.json');

const expectedEmbedded = require('./fixtures/expected/expected_embedded.json');
const expectedExtended = require('./fixtures/expected/expected_extended.json');
const expectedPatientGroups = require('./fixtures/expected/expected_patient_groups.json');
const expectedPatientGroupsNotContained = require('./fixtures/expected/expected_patient_groups_not_contained.json');
const expectedSecondPatientGroups = require('./fixtures/expected/expected_second_patient_groups.json');
const expectedBothPatientsGroups = require('./fixtures/expected/expected_both_patients_groups.json');
const expectedPatientGroupsFlagOff = require('./fixtures/expected/expected_patient_groups_flag_off.json');
const expectedPatientGroupsDebug = require('./fixtures/expected/expected_patient_groups_debug.json');
const expectedBothPatientsGroupsDebug = require('./fixtures/expected/expected_both_patients_groups_debug.json');
const expectedPatientGroupsDebugFlagOff = require('./fixtures/expected/expected_patient_groups_debug_flag_off.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersWithAdmin,
    getHeadersJsonPatch,
    createTestRequest,
    getTestContainer
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../../utils/mongoGroupExtendedTag');

describe('$graph with extended Groups', () => {
    let request;
    let originalEnableExtendedGroup;

    beforeEach(async () => {
        originalEnableExtendedGroup = process.env.ENABLE_EXTENDED_GROUP;
        process.env.ENABLE_EXTENDED_GROUP = '1';
        await commonBeforeEach();
        request = await createTestRequest();

        const merge = await request
            .post('/4_0_0/Patient/1/$merge')
            .send([
                patientResource, patient2Resource, embeddedGroupResource, extendedGroupResource, extendedBothGroupResource
            ])
            .set(getHeaders());
        expect(merge).toHaveMergeResponse([
            { created: true }, { created: true }, { created: true }, { created: true }, { created: true }
        ]);

        // promote the Groups to extended, then add their roster rows through PATCH
        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        for (const group of [extendedGroupResource, extendedBothGroupResource]) {
            await db.collection('Group_4_0_0').updateOne(
                { id: group.id },
                { $set: { [MONGO_GROUP_EXTENDED_FIELD]: true } }
            );
        }
        // extended: patient1 only; extended-both: patient1 and patient2
        for (const [group, patient] of [
            [extendedGroupResource, patientResource],
            [extendedBothGroupResource, patientResource],
            [extendedBothGroupResource, patient2Resource]
        ]) {
            const patch = await request
                .patch(`/4_0_0/Group/${group.id}`)
                .send([{ op: 'add', path: '/member/-', value: { entity: { reference: `Patient/${patient.id}|test-owner` } } }])
                .set(getHeadersJsonPatch());
            expect(patch.status).toBe(200);
        }
    });

    afterEach(async () => {
        await commonAfterEach();
        process.env.ENABLE_EXTENDED_GROUP = originalEnableExtendedGroup;
    });

    const graph = (id, contained = true, headers = getHeaders()) => request
        .post(`/4_0_0/Group/$graph?id=${id}&contained=${contained}`)
        .set(headers)
        .send(graphDefinitionResource);

    const patientGraph = (ids, contained = true, extraQuery = '', headers = getHeaders()) => request
        .post(`/4_0_0/Patient/$graph?id=${ids.join(',')}&contained=${contained}${extraQuery}`)
        .set(headers)
        .send(reverseGraphDefinitionResource);

    test('an embedded Group still expands its members', async () => {
        const resp = await graph(embeddedGroupResource.id);

        expect(resp).toHaveResponse(expectedEmbedded);
    });

    test('an extended Group is returned tagged, with no member[] and nothing expanded under it', async () => {
        const resp = await graph(extendedGroupResource.id);

        expect(resp).toHaveResponse(expectedExtended);
    });

    test('an extended Group is returned the same way when contained=false', async () => {
        const resp = await graph(extendedGroupResource.id, false);

        expect(resp).toHaveResponse(expectedExtended);
    });

    test('with ENABLE_EXTENDED_GROUP off the response for an extended Group is the same', async () => {
        const savedEnableExtendedGroup = process.env.ENABLE_EXTENDED_GROUP;
        delete process.env.ENABLE_EXTENDED_GROUP;
        try {
            const resp = await graph(extendedGroupResource.id);

            expect(resp).toHaveResponse(expectedExtended);
        } finally {
            process.env.ENABLE_EXTENDED_GROUP = savedEnableExtendedGroup;
        }
    });

    test('an extended Group owned by another tenant is not returned to a scoped caller', async () => {
        const resp = await graph(extendedGroupResource.id, true, getHeaders('user/*.read access/other-owner.*'));

        expect(resp.status).toBe(200);
        expect(resp.body.entry || []).toHaveLength(0);
    });

    describe('reverse link Patient -> Group (member={ref})', () => {
        test('returns the extended Groups the Patient is in, next to the embedded Group', async () => {
            const resp = await patientGraph([patientResource.id]);

            expect(resp).toHaveResponse(expectedPatientGroups);
        });

        test('returns them as separate entries when contained=false', async () => {
            const resp = await patientGraph([patientResource.id], false);

            expect(resp).toHaveResponse(expectedPatientGroupsNotContained);
        });

        test('a Patient only gets the extended Groups whose roster includes it', async () => {
            const resp = await patientGraph([patient2Resource.id]);

            expect(resp).toHaveResponse(expectedSecondPatientGroups);
        });

        test('with several Patients each extended Group is attached under the Patients in its roster', async () => {
            const resp = await patientGraph([patientResource.id, patient2Resource.id]);

            expect(resp).toHaveResponse(expectedBothPatientsGroups);
        });

        test('with ENABLE_EXTENDED_GROUP off only the embedded Group is returned', async () => {
            const savedEnableExtendedGroup = process.env.ENABLE_EXTENDED_GROUP;
            delete process.env.ENABLE_EXTENDED_GROUP;
            try {
                const resp = await patientGraph([patientResource.id]);

                expect(resp).toHaveResponse(expectedPatientGroupsFlagOff);
            } finally {
                process.env.ENABLE_EXTENDED_GROUP = savedEnableExtendedGroup;
            }
        });
    });

    describe('_debug on the reverse link Patient -> Group', () => {
        test('lists the GroupMember lookup the Group query was built from', async () => {
            const resp = await patientGraph([patientResource.id], true, '&_debug=1', getHeadersWithAdmin());

            expect(resp).toHaveMongoQuery(expectedPatientGroupsDebug);
            expect(resp).toHaveResponse(expectedPatientGroupsDebug);
        });

        test('lists it once for several Patients', async () => {
            const resp = await patientGraph(
                [patientResource.id, patient2Resource.id], true, '&_debug=1', getHeadersWithAdmin()
            );

            expect(resp).toHaveMongoQuery(expectedBothPatientsGroupsDebug);
            expect(resp).toHaveResponse(expectedBothPatientsGroupsDebug);
        });

        test('with ENABLE_EXTENDED_GROUP off no GroupMember lookup is listed', async () => {
            const savedEnableExtendedGroup = process.env.ENABLE_EXTENDED_GROUP;
            delete process.env.ENABLE_EXTENDED_GROUP;
            try {
                const resp = await patientGraph([patientResource.id], true, '&_debug=1', getHeadersWithAdmin());

                expect(resp).toHaveMongoQuery(expectedPatientGroupsDebugFlagOff);
                expect(resp).toHaveResponse(expectedPatientGroupsDebugFlagOff);
            } finally {
                process.env.ENABLE_EXTENDED_GROUP = savedEnableExtendedGroup;
            }
        });
    });
});
