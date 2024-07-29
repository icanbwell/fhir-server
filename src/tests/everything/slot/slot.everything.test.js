// practice
const slotResource = require('./fixtures/slot/slot.json');
const slotScheduleResource = require('./fixtures/slot/schedule.json');
const slotPractitionerRoleResource = require('./fixtures/slot/practitionerRole.json');
const slotPractitionerResource = require('./fixtures/slot/practitioner.json');

// expected
const expectedEverythingResource = require('./fixtures/expected/expected_everything.json');
const expectedEverythingResourceType1 = require('./fixtures/expected/expected_everything_type1.json');
const expectedEverythingResourceType2 = require('./fixtures/expected/expected_everything_type2.json');
const expectedEverythingResourceType3 = require('./fixtures/expected/expected_everything_type3.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { logInfo } = require('../../../operations/common/logging');
const { findDuplicateResourcesById } = require('../../../utils/list.util');

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
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Schedule/1/$merge')
                .send(slotScheduleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/PractitionerRole/1/$merge')
                .send(slotPractitionerRoleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Practitioner/$merge')
                .send(slotPractitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Slot/1275501447-UHG-MMMA-existing/$everything')
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedEverythingResource);
            logInfo('----- Received resources ----', {});
            logInfo(
                `${resp.body.entry.map((e) => e.resource).map((a) => `${a.resourceType}/${a.id}`)}`,
                {}
            );
            logInfo('----- End of Received resources ----', {});
            // verify there are no duplicate ids
            const duplicates = findDuplicateResourcesById(resp.body.entry.map((e) => e.resource));
            expect(duplicates.map((a) => `${a.resourceType}/${a.id}`)).toStrictEqual([]);
        });

        test('Everything works with _type', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Practitioner').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Slot/1/$merge')
                .send(slotResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Schedule/1/$merge')
                .send(slotScheduleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/PractitionerRole/1/$merge')
                .send(slotPractitionerRoleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Practitioner/$merge')
                .send(slotPractitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Slot/1275501447-UHG-MMMA-existing/$everything?_type=Slot')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedEverythingResourceType1);

            resp = await request
                .get('/4_0_0/Slot/1275501447-UHG-MMMA-existing/$everything?_type=Practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedEverythingResourceType2);

            resp = await request
                .get('/4_0_0/Slot/1275501447-UHG-MMMA-existing/$everything?_type=PractitionerRole,Schedule')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedEverythingResourceType3);
        });
    });
});
