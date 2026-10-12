/**
 * DCON-5657: extended Groups in Patient/Person $everything.
 *
 * An extended Group has no inline member[] (its roster lives in GroupMember_4_0_0). The Group
 * query already finds it (GroupMemberQueryRewriter); processCursorAsync must also accept it as a
 * child of the requested Patient, and the read-side enrichment tags it.
 *
 * ENABLE_EXTENDED_GROUP is set to '1' globally in jest/setEnvVars.js.
 */
const { describe, test, beforeAll, afterAll, expect } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders,
    getHeadersJsonPatch,
    withExtendedGroupDisabled
} = require('../../common');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../../utils/mongoGroupExtendedTag');

const OWNER = 'test-owner';
const OTHER_OWNER = 'other-owner';
const PERSON_ID = '5a1c0d2e-7b34-4c8a-9f10-2d6e8b0a1c01';
const OTHER_PERSON_ID = '5a1c0d2e-7b34-4c8a-9f10-2d6e8b0a1c02';
const PATIENT_ID = '5a1c0d2e-7b34-4c8a-9f10-2d6e8b0a1c03';
const OTHER_PATIENT_ID = '5a1c0d2e-7b34-4c8a-9f10-2d6e8b0a1c04';

const meta = (owner = OWNER) => ({
    source: 'http://test-system.com/dcon5657',
    security: [
        { system: 'https://www.icanbwell.com/owner', code: owner },
        { system: 'https://www.icanbwell.com/access', code: owner }
    ]
});

const EXTENDED_TAG = { system: 'https://www.icanbwell.com/groupSize', code: 'extended' };

describe('$everything returns extended Groups', () => {
    let request;

    beforeAll(async () => {
        await commonBeforeEach();
        request = await createTestRequest();

        const merge = await request
            .post('/4_0_0/Person/1/$merge')
            .send([
                {
                    resourceType: 'Person',
                    id: PERSON_ID,
                    meta: meta(),
                    link: [{ target: { reference: `Patient/${PATIENT_ID}|${OWNER}`, type: 'Patient' }, assurance: 'level4' }]
                },
                {
                    resourceType: 'Person',
                    id: OTHER_PERSON_ID,
                    meta: meta(),
                    link: [{ target: { reference: `Patient/${OTHER_PATIENT_ID}|${OWNER}`, type: 'Patient' }, assurance: 'level4' }]
                },
                { resourceType: 'Patient', id: PATIENT_ID, meta: meta() },
                { resourceType: 'Patient', id: OTHER_PATIENT_ID, meta: meta() }
            ])
            .set(getHeaders());
        expect(merge.status).toBe(200);
    });

    afterAll(async () => {
        await commonAfterEach();
    });

    async function createGroup (name, member, owner = OWNER) {
        const response = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                type: 'person',
                actual: true,
                name,
                meta: meta(owner),
                ...(member ? { member: [{ entity: { reference: member } }] } : {})
            })
            .set(getHeaders());
        expect(response.status).toBe(201);
        return response.body;
    }

    async function makeExtended (groupId, memberReference) {
        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        await db.collection('Group_4_0_0').updateOne({ id: groupId }, { $set: { [MONGO_GROUP_EXTENDED_FIELD]: true } });
        const patch = await request
            .patch(`/4_0_0/Group/${groupId}`)
            .send([{ op: 'add', path: '/member/-', value: { entity: { reference: memberReference } } }])
            .set(getHeadersJsonPatch());
        expect(patch.status).toBe(200);
    }

    const groupsByName = (bundle) => Object.fromEntries(
        (bundle.entry || []).filter((e) => e.resource.resourceType === 'Group').map((e) => [e.resource.name, e.resource])
    );

    test('Patient and Person $everything return the extended Group (tagged, no member[]) and the embedded Group', async () => {
        const embedded = await createGroup('embedded', `Patient/${PATIENT_ID}|${OWNER}`);
        const extended = await createGroup('extended');
        await makeExtended(extended.id, `Patient/${PATIENT_ID}|${OWNER}`);
        const unrelated = await createGroup('unrelated-extended');
        await makeExtended(unrelated.id, `Patient/${OTHER_PATIENT_ID}|${OWNER}`);
        expect(embedded.id).toBeDefined();

        for (const url of [
            `/4_0_0/Patient/${PATIENT_ID}/$everything?_type=Patient,Group`,
            `/4_0_0/Person/${PERSON_ID}/$everything?_type=Person,Patient,Group`
        ]) {
            const response = await request.get(url).set(getHeaders());
            expect(response.status).toBe(200);
            const groups = groupsByName(response.body);

            expect(groups.embedded.member).toHaveLength(1);
            expect((groups.embedded.meta.tag || []).some((t) => t.system === EXTENDED_TAG.system)).toBe(false);

            expect(groups.extended).toBeDefined();
            expect(groups.extended.member).toBeUndefined();
            expect(groups.extended.meta.tag).toEqual(expect.arrayContaining([
                expect.objectContaining(EXTENDED_TAG)
            ]));

            // an extended Group whose roster does not include the requested patient stays out
            expect(groups['unrelated-extended']).toBeUndefined();
        }
    });

    test('an extended Group owned by another tenant is not returned to a scoped caller', async () => {
        const foreign = await createGroup('foreign-extended', undefined, OTHER_OWNER);
        await makeExtended(foreign.id, `Patient/${PATIENT_ID}|${OWNER}`);

        const response = await request
            .get(`/4_0_0/Patient/${PATIENT_ID}/$everything?_type=Group`)
            .set(getHeaders('user/*.read access/test-owner.*'));

        expect(response.status).toBe(200);
        expect(groupsByName(response.body)['foreign-extended']).toBeUndefined();
    });

    test('_includeUuidOnly still returns the extended Group', async () => {
        const response = await request
            .get(`/4_0_0/Patient/${PATIENT_ID}/$everything?_type=Group&_includeUuidOnly=1`)
            .set(getHeaders());

        expect(response.status).toBe(200);
        const groupResources = response.body.entry.filter((e) => e.resource.resourceType === 'Group');
        expect(groupResources.length).toBeGreaterThanOrEqual(2);
    });

    test('with ENABLE_EXTENDED_GROUP off the extended Group is not returned and the embedded Group is unchanged', async () => {
        // the roster write (PATCH member) needs the flag on, so set the Groups up first
        const embedded = await createGroup('flag-off-embedded', `Patient/${PATIENT_ID}|${OWNER}`);
        const extended = await createGroup('flag-off-extended');
        await makeExtended(extended.id, `Patient/${PATIENT_ID}|${OWNER}`);
        expect(embedded.id).toBeDefined();

        await withExtendedGroupDisabled(async () => {
            const response = await request
                .get(`/4_0_0/Patient/${PATIENT_ID}/$everything?_type=Patient,Group`)
                .set(getHeaders());

            expect(response.status).toBe(200);
            const names = (response.body.entry || [])
                .filter((e) => e.resource.resourceType === 'Group')
                .map((e) => e.resource.name);
            expect(names).toContain('flag-off-embedded');
            expect(names).not.toContain('flag-off-extended');
        });
    });

    describe('several ids in one request', () => {
        const A = `Patient/${PATIENT_ID}|${OWNER}`;
        const B = `Patient/${OTHER_PATIENT_ID}|${OWNER}`;
        const multiNames = (bundle) => Object.keys(groupsByName(bundle)).filter((n) => n.startsWith('multi-')).sort();

        beforeAll(async () => {
            const embedded = await createGroup('multi-embedded-a-b', A);
            const patch = await request
                .patch(`/4_0_0/Group/${embedded.id}`)
                .send([{ op: 'add', path: '/member/-', value: { entity: { reference: B } } }])
                .set(getHeadersJsonPatch());
            expect(patch.status).toBe(200);
            const onlyA = await createGroup('multi-ext-a');
            await makeExtended(onlyA.id, A);
            const onlyB = await createGroup('multi-ext-b');
            await makeExtended(onlyB.id, B);
            const both = await createGroup('multi-ext-a-b');
            await makeExtended(both.id, A);
            const patchBoth = await request
                .patch(`/4_0_0/Group/${both.id}`)
                .send([{ op: 'add', path: '/member/-', value: { entity: { reference: B } } }])
                .set(getHeadersJsonPatch());
            expect(patchBoth.status).toBe(200);
        });

        const BOTH = ['multi-embedded-a-b', 'multi-ext-a', 'multi-ext-a-b', 'multi-ext-b'];
        const ONLY_A = ['multi-embedded-a-b', 'multi-ext-a', 'multi-ext-a-b'];

        test.each([
            ['Patient id=a,b', `/4_0_0/Patient/$everything?_type=Patient,Group&id=${PATIENT_ID},${OTHER_PATIENT_ID}`, BOTH],
            ['Patient id=a&id=b', `/4_0_0/Patient/$everything?_type=Patient,Group&id=${PATIENT_ID}&id=${OTHER_PATIENT_ID}`, BOTH],
            ['Patient id=a', `/4_0_0/Patient/$everything?_type=Patient,Group&id=${PATIENT_ID}`, ONLY_A],
            ['Person id=a,b', `/4_0_0/Person/$everything?_type=Person,Patient,Group&id=${PERSON_ID},${OTHER_PERSON_ID}`, BOTH],
            ['Person id=a&id=b', `/4_0_0/Person/$everything?_type=Person,Patient,Group&id=${PERSON_ID}&id=${OTHER_PERSON_ID}`, BOTH],
            ['Person /a/', `/4_0_0/Person/${PERSON_ID}/$everything?_type=Person,Patient,Group`, ONLY_A]
        ])('%s returns each matching Group exactly once', async (_label, url, expectedNames) => {
            const response = await request.get(url).set(getHeaders());

            expect(response.status).toBe(200);
            // a Group whose roster holds both patients (multi-ext-a-b) must not be duplicated
            const names = response.body.entry
                .filter((e) => e.resource.resourceType === 'Group' && e.resource.name.startsWith('multi-'))
                .map((e) => e.resource.name)
                .sort();
            expect(names).toEqual(expectedNames);
            expect(multiNames(response.body)).toEqual(expectedNames);

            const groups = groupsByName(response.body);
            for (const name of expectedNames.filter((n) => n.startsWith('multi-ext'))) {
                expect(groups[name].member).toBeUndefined();
                expect(groups[name].meta.tag).toEqual(expect.arrayContaining([expect.objectContaining(EXTENDED_TAG)]));
            }
            expect(groups['multi-embedded-a-b'].member).toHaveLength(2);
        });
    });
});
