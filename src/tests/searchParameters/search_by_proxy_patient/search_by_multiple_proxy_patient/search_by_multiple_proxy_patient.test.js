// test file
const patient1 = require('./fixtures/Patient/p1.json');
const patient2 = require('./fixtures/Patient/p2.json');
const patient3 = require('./fixtures/Patient/p3.json');
const patient4 = require('./fixtures/Patient/p4.json');

const bwellPerson1 = require('./fixtures/Person/bwellPerson1.json');
const bwellPerson2 = require('./fixtures/Person/bwellPerson2.json');
const northwellPerson1 = require('./fixtures/Person/northwellPerson1.json');
const northwellPerson2 = require('./fixtures/Person/northwellPerson2.json');

const observation1 = require('./fixtures/Observations/observation1.json');
const observation2 = require('./fixtures/Observations/observation2.json');
const observation3 = require('./fixtures/Observations/observation3.json');
const observation4 = require('./fixtures/Observations/observation4.json');
const observation5 = require('./fixtures/Observations/observation5.json');

// expected
const expectedSinglePerson = require('./expected/expectedSinglePerson.json');
const expectedMultiplePerson = require('./expected/expectedMultiplePerson.json');
const expectedPatientsWithProxyPatient = require('./expected/expectedPatientsWithProxyPatient.json');
const expectedObservationsWithProxyPatients = require('./expected/expectedObservationWithProxyPatient.json');
const expectedObservationWithDirectlyLinkedProxyPatient = require('./expected/expectedObservationWithDirectlyLinkedProxyPatient.json');
const expectedWithWrongProxyPatient = require('./expected/expectedWithWrongProxyPatient.json');
const expectedObservationWithProxyPatientAndSomeWrongProxyPatient = require('./expected/expectedObservationWithProxyPatientAndSomeWrongProxyPatient.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../../common');
const { describe, beforeEach, afterEach, test } = require('@jest/globals');
const { ConfigManager } = require('../../../../utils/configManager');
const deepcopy = require('deepcopy');

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
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMultiplePerson);
        });

        test('search patient by proxy-person should work correctly', async () => {
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
                    '/4_0_0/Patient/?id=person.54808e62-6445-4bb6-8f89-b2ed7e6865d2,person.cda43a72-b5e0-476a-a928-4d768e66d6f8'
                )
                .set(getHeaders());
            expect(resp).toHaveResponse(expectedPatientsWithProxyPatient);

        });

        test('search patient by proxy-person should return empty result when person is not present', async () => {
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
            const emptyEntries = deepcopy(expectedPatientsWithProxyPatient);
            emptyEntries.entry = [];
            // ACT & ASSERT
            // search by token system and code and make sure we get the right Patient back
            resp = await request
                .get(
                    '/4_0_0/Patient/?id=person.wrong1'
                )
                .set(getHeaders());
            expect(resp).toHaveResponse(emptyEntries);

        });

        test('search observation by proxy-person should work correctly with multiple proxy persons', async () => {
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
                    observation1,
                    observation2,
                    observation3,
                    observation4,
                ])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
            // ACT & ASSERT
            // search by token system and code and make sure we get the right Patient back
            resp = await request
                .get(
                    '/4_0_0/Observation/?patient=Patient/person.54808e62-6445-4bb6-8f89-b2ed7e6865d2,Patient/person.cda43a72-b5e0-476a-a928-4d768e66d6f8'
                )
                .set(getHeaders());
            expect(resp).toHaveResponse(expectedObservationsWithProxyPatients);

        });

        test('search observation by proxy-person should also include resources with directly linked proxy-patient', async () => {
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
                    observation1,
                    observation2,
                    observation3,
                    observation4,
                    observation5,
                ])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
            // ACT & ASSERT
            // search by token system and code and make sure we get the right Patient back
            resp = await request
                .get(
                    '/4_0_0/Observation/?patient=person.54808e62-6445-4bb6-8f89-b2ed7e6865d2,person.cda43a72-b5e0-476a-a928-4d768e66d6f8'
                )
                .set(getHeaders());
            expect(resp).toHaveResponse(expectedObservationWithDirectlyLinkedProxyPatient);

        });

        test('search observation by proxy-person should return 0 entries if wrong proxy-person is passed', async () => {
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
                    observation1,
                    observation2,
                    observation3,
                    observation4,
                    observation5,
                ])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
            // ACT & ASSERT
            // search by token system and code and make sure we get the right Patient back
            resp = await request
                .get(
                    '/4_0_0/Observation/?patient=Patient/person.notexist,person.notexist2,person.notexist3&_debug=true'
                )
                .set(getHeaders());
            expect(resp).toHaveResponse(expectedWithWrongProxyPatient);

        });

        test('search observation by proxy-person should work correctly when some proxy-person-id are non existent', async () => {
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
                    observation1,
                    observation2,
                    observation3,
                    observation4,
                ])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
            // ACT & ASSERT
            // search by token system and code and make sure we get the right Patient back
            resp = await request
                .get(
                    '/4_0_0/Observation/?patient=Patient/person.54808e62-6445-4bb6-8f89-b2ed7e6865d2,Patient/person.cda43a72-b5e0-476a-a928-4d768e66d6f8,Patient/person.notExist3&_debug=true'
                )
                .set(getHeaders());
            expect(resp).toHaveResponse(expectedObservationWithProxyPatientAndSomeWrongProxyPatient);

        });
    });
});
