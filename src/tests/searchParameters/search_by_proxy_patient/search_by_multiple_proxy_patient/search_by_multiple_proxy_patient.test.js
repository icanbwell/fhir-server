// test file
const patient1 = require('./fixtures/Patient/p1.json');
const patient2 = require('./fixtures/Patient/p2.json');
const patient3 = require('./fixtures/Patient/p3.json');
const patient4 = require('./fixtures/Patient/p4.json');

const bwellPerson1 = require('./fixtures/Person/bwellPerson1.json');
const bwellPerson2 = require('./fixtures/Person/bwellPerson2.json');
const northwellPerson1 = require('./fixtures/Person/northwellPerson1.json');
const northwellPerson2 = require('./fixtures/Person/northwellPerson2.json');

// expected
const expectedSinglePerson = require('./expected/expectedSinglePerson.json');
const expectedMultiplePerson = require('./expected/expectedMultiplePerson.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../../common');
const { describe, beforeEach, afterEach, test } = require('@jest/globals');
const { ConfigManager } = require('../../../../utils/configManager');

class MockConfigManager extends ConfigManager {
    get enableGlobalIdSupport() {
        return true;
    }

    get enableReturnBundle() {
        return true;
    }

    get supportLegacyIds() {
        return false;
    }
}

describe('Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Resources search_by_proxy_patient Multiple Tests', () => {
        test('search person by patient for proxy patients includes proxy patient itself for single proxy person', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send([
                    bwellPerson1,
                    bwellPerson2,
                    northwellPerson1,
                    northwellPerson2,
                    patient1,
                    patient2,
                    patient3,
                    patient4,
                ])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Patient back
            resp = await request
                .get(
                    '/4_0_0/Person/?_bundle=1&patient=Patient/person.54808e62-6445-4bb6-8f89-b2ed7e6865d2'
                )
                .set(getHeaders());
            console.log(JSON.stringify(JSON.parse(resp.text), null, '\t'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePerson);
        });

        test('search person by patient for proxy patients includes correct proxy patient itself for multiple proxy person', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send([
                    bwellPerson1,
                    bwellPerson2,
                    northwellPerson1,
                    northwellPerson2,
                    patient1,
                    patient2,
                    patient3,
                    patient4,
                ])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Patient back
            resp = await request
                .get(
                    '/4_0_0/Person/?_bundle=1&patient=Patient/person.54808e62-6445-4bb6-8f89-b2ed7e6865d2,Patient/person.cda43a72-b5e0-476a-a928-4d768e66d6f8'
                )
                .set(getHeaders());
            console.log(JSON.stringify(JSON.parse(resp.text), null, '\t'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMultiplePerson);
        });
    });
});
