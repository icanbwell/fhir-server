// practice
const slotResource = require('./fixtures/slot/slot.json');
const slotScheduleResource = require('./fixtures/slot/schedule.json');
const slotPractitionerRoleResource = require('./fixtures/slot/practitionerRole.json');
const slotPractitionerResource = require('./fixtures/slot/practitioner.json');

// expected
const expectedEverythingResource = require('./fixtures/expected/expected_everything.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');
const {findDuplicateResources} = require('../../../utils/list.util');

describe('Slot Everything Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Everything Tests', () => {
        test('Everything works properly', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Practitioner').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Slot/1/$merge')
                .send(slotResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Schedule/1/$merge')
                .send(slotScheduleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/PractitionerRole/1/$merge')
                .send(slotPractitionerRoleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Practitioner/$merge')
                .send(slotPractitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Slot/1275501447-UHG-MMMA-existing/$everything')
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedEverythingResource);
            console.log('----- Received resources ----');
            console.log(
                `${resp.body.entry.map((e) => e.resource).map((a) => `${a.resourceType}/${a.id}`)}`
            );
            console.log('----- End of Received resources ----');
            // verify there are no duplicate ids
            const duplicates = findDuplicateResources(resp.body.entry.map((e) => e.resource));
            expect(duplicates.map((a) => `${a.resourceType}/${a.id}`)).toStrictEqual([]);
        });
    });
});
