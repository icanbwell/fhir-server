// test file
const person1 = require('./fixtures/person/person1.json');
const person2 = require('./fixtures/person/person2.json');
const patient1 = require('./fixtures/patient/patient1.json');

// expected
const expectedPerson1BeforeRun = require('./fixtures/expected/expectedPerson1BeforeRun.json');
const expectedPerson1AfterRun = require('./fixtures/expected/expectedPerson1AfterRun.json');

const expectedPerson2BeforeRun = require('./fixtures/expected/expectedPerson2BeforeRun.json');
const expectedPerson2AfterRun = require('./fixtures/expected/expectedPerson2AfterRun.json');

const expectedPatient1 = require('./fixtures/expected/expectedPatient1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders
} = require('../../../common');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { assertTypeEquals } = require('../../../../utils/assertType');
const {
    ClientPersonToProaPatientLinkRunner
} = require('../../../../admin/runners/clientPersonToProaPatientLinkRunner');
const { AdminPersonPatientLinkManager } = require('../../../../admin/adminPersonPatientLinkManager');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Person Tests', () => {
    beforeEach(async () => {
        const container = getTestContainer();
        if (container) {
            delete container.services.clientPersonToProaPatientLink;
        }
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Client Person to Proa Patient Tests', () => {
        test('Both client persons are linked', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send([person1, person2, patient1])
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse([
                { created: true },
                { created: true },
                { created: true }
            ]);

            resp = await request.get(`/4_0_0/Person/${person1.id}`).set(getHeaders()).expect(200);

            const person1BeforeRun = resp.body;
            delete person1BeforeRun.meta.lastUpdated;
            expect(person1BeforeRun).toEqual(expectedPerson1BeforeRun);

            resp = await request.get(`/4_0_0/Person/${person2.id}`).set(getHeaders()).expect(200);

            const person2BeforeRun = resp.body;
            delete person2BeforeRun.meta.lastUpdated;
            expect(person2BeforeRun).toEqual(expectedPerson2BeforeRun);

            resp = await request.get(`/4_0_0/Patient/${patient1.id}`).set(getHeaders()).expect(200);

            const patient1BeforeRun = resp.body;
            delete patient1BeforeRun.meta.lastUpdated;
            expect(patient1BeforeRun).toEqual(expectedPatient1);

            const container = getTestContainer();

            container.register(
                'clientPersonToProaPatientLink',
                (c) =>
                    new ClientPersonToProaPatientLinkRunner({
                        csvFileName: '/src/tests/admin/runners/clientPersonToProaPatientLink/fixtures/csv/test1.csv',
                        proaPatientUuidColumn: 0,
                        proaPatientSourceAssigningAuthorityColumn: 1,
                        clientUuidColumn: 2,
                        statusColumn: 3,
                        adminLogger: new AdminLogger(),
                        adminPersonPatientLinkManager: new AdminPersonPatientLinkManager({
                            databaseQueryFactory: c.databaseQueryFactory,
                            databaseUpdateFactory: c.databaseUpdateFactory,
                            fhirOperationsManager: c.fhirOperationsManager,
                            postSaveProcessor: c.postSaveProcessor,
                            patientFilterManager: c.patientFilterManager
                        })
                    })
            );

            /**
             * @type {ClientPersonToProaPatientLinkRunner}
             */
            const clientPersonToProaPatientLink = container.clientPersonToProaPatientLink;
            assertTypeEquals(clientPersonToProaPatientLink, ClientPersonToProaPatientLinkRunner);
            await clientPersonToProaPatientLink.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${person1.id}`)
                .set(getHeaders())
                .expect(200);

            const person1AfterRun = resp.body;
            delete person1AfterRun.meta.lastUpdated;
            expect(person1AfterRun).toEqual(expectedPerson1AfterRun);

            resp = await request
                .get(`/4_0_0/Person/${person2.id}`)
                .set(getHeaders())
                .expect(200);

            const person2AfterRun = resp.body;
            delete person2AfterRun.meta.lastUpdated;
            expect(person2AfterRun).toEqual(expectedPerson2AfterRun);

            resp = await request
                .get(`/4_0_0/Patient/${patient1.id}`)
                .set(getHeaders())
                .expect(200);

            const patient1AfterRun = resp.body;
            delete patient1AfterRun.meta.lastUpdated;
            expect(patient1AfterRun).toEqual(expectedPatient1);

            resp = await request
                .get(`/4_0_0/Person/_history?id=${person1.id}`)
                .set(getHeaders())
                .expect(200);

            const person1History = resp.body;

            expect(person1History.entry).toBeDefined();
            expect(person1History.entry.length).toEqual(2);

            delete person1History.entry[0].resource.meta.lastUpdated;
            expect(person1History.entry[0].resource).toEqual(expectedPerson1AfterRun);

            delete person1History.entry[1].resource.meta.lastUpdated;
            expect(person1History.entry[1].resource).toEqual(expectedPerson1BeforeRun);

            resp = await request
                .get(`/4_0_0/Person/_history?id=${person2.id}`)
                .set(getHeaders())
                .expect(200);

            const person2History = resp.body;

            expect(person2History.entry).toBeDefined();
            expect(person2History.entry.length).toEqual(2);

            delete person2History.entry[0].resource.meta.lastUpdated;
            expect(person2History.entry[0].resource).toEqual(expectedPerson2AfterRun);

            delete person2History.entry[1].resource.meta.lastUpdated;
            expect(person2History.entry[1].resource).toEqual(expectedPerson2BeforeRun);
        });

        test('Only client person 1 is linked, no change in client person 2', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send([person1, person2, patient1])
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse([
                { created: true },
                { created: true },
                { created: true }
            ]);

            resp = await request.get(`/4_0_0/Person/${person1.id}`).set(getHeaders()).expect(200);

            const person1BeforeRun = resp.body;
            delete person1BeforeRun.meta.lastUpdated;
            expect(person1BeforeRun).toEqual(expectedPerson1BeforeRun);

            resp = await request.get(`/4_0_0/Person/${person2.id}`).set(getHeaders()).expect(200);

            const person2BeforeRun = resp.body;
            delete person2BeforeRun.meta.lastUpdated;
            expect(person2BeforeRun).toEqual(expectedPerson2BeforeRun);

            resp = await request.get(`/4_0_0/Patient/${patient1.id}`).set(getHeaders()).expect(200);

            const patient1BeforeRun = resp.body;
            delete patient1BeforeRun.meta.lastUpdated;
            expect(patient1BeforeRun).toEqual(expectedPatient1);

            const container = getTestContainer();

            container.register(
                'clientPersonToProaPatientLink',
                (c) =>
                    new ClientPersonToProaPatientLinkRunner({
                        csvFileName: '/src/tests/admin/runners/clientPersonToProaPatientLink/fixtures/csv/test2.csv',
                        proaPatientUuidColumn: 0,
                        proaPatientSourceAssigningAuthorityColumn: 1,
                        clientUuidColumn: 2,
                        statusColumn: 3,
                        adminLogger: new AdminLogger(),
                        adminPersonPatientLinkManager: new AdminPersonPatientLinkManager({
                            databaseQueryFactory: c.databaseQueryFactory,
                            databaseUpdateFactory: c.databaseUpdateFactory,
                            fhirOperationsManager: c.fhirOperationsManager,
                            postSaveProcessor: c.postSaveProcessor,
                            patientFilterManager: c.patientFilterManager
                        })
                    })
            );

            /**
             * @type {ClientPersonToProaPatientLinkRunner}
             */
            const clientPersonToProaPatientLink = container.clientPersonToProaPatientLink;
            assertTypeEquals(clientPersonToProaPatientLink, ClientPersonToProaPatientLinkRunner);
            await clientPersonToProaPatientLink.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${person1.id}`)
                .set(getHeaders())
                .expect(200);

            const person1AfterRun = resp.body;
            delete person1AfterRun.meta.lastUpdated;
            expect(person1AfterRun).toEqual(expectedPerson1AfterRun);

            resp = await request
                .get(`/4_0_0/Person/${person2.id}`)
                .set(getHeaders())
                .expect(200);

            const person2AfterRun = resp.body;
            delete person2AfterRun.meta.lastUpdated;
            expect(person2AfterRun).toEqual(expectedPerson2BeforeRun);

            resp = await request
                .get(`/4_0_0/Patient/${patient1.id}`)
                .set(getHeaders())
                .expect(200);

            const patient1AfterRun = resp.body;
            delete patient1AfterRun.meta.lastUpdated;
            expect(patient1AfterRun).toEqual(expectedPatient1);

            resp = await request
                .get(`/4_0_0/Person/_history?id=${person1.id}`)
                .set(getHeaders())
                .expect(200);

            const person1History = resp.body;

            expect(person1History.entry).toBeDefined();
            expect(person1History.entry.length).toEqual(2);

            delete person1History.entry[0].resource.meta.lastUpdated;
            expect(person1History.entry[0].resource).toEqual(expectedPerson1AfterRun);

            delete person1History.entry[1].resource.meta.lastUpdated;
            expect(person1History.entry[1].resource).toEqual(expectedPerson1BeforeRun);

            resp = await request
                .get(`/4_0_0/Person/_history?id=${person2.id}`)
                .set(getHeaders())
                .expect(200);

            const person2History = resp.body;

            expect(person2History.entry).toBeDefined();
            expect(person2History.entry.length).toEqual(1);

            delete person2History.entry[0].resource.meta.lastUpdated;
            expect(person2History.entry[0].resource).toEqual(expectedPerson2BeforeRun);
        });

        test('Multiple Rows work', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send([person1, person2, patient1])
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse([
                { created: true },
                { created: true },
                { created: true }
            ]);

            resp = await request.get(`/4_0_0/Person/${person1.id}`).set(getHeaders()).expect(200);

            const person1BeforeRun = resp.body;
            delete person1BeforeRun.meta.lastUpdated;
            expect(person1BeforeRun).toEqual(expectedPerson1BeforeRun);

            resp = await request.get(`/4_0_0/Person/${person2.id}`).set(getHeaders()).expect(200);

            const person2BeforeRun = resp.body;
            delete person2BeforeRun.meta.lastUpdated;
            expect(person2BeforeRun).toEqual(expectedPerson2BeforeRun);

            resp = await request.get(`/4_0_0/Patient/${patient1.id}`).set(getHeaders()).expect(200);

            const patient1BeforeRun = resp.body;
            delete patient1BeforeRun.meta.lastUpdated;
            expect(patient1BeforeRun).toEqual(expectedPatient1);

            const container = getTestContainer();

            container.register(
                'clientPersonToProaPatientLink',
                (c) =>
                    new ClientPersonToProaPatientLinkRunner({
                        csvFileName: '/src/tests/admin/runners/clientPersonToProaPatientLink/fixtures/csv/test3.csv',
                        proaPatientUuidColumn: 0,
                        proaPatientSourceAssigningAuthorityColumn: 1,
                        clientUuidColumn: 2,
                        statusColumn: 3,
                        adminLogger: new AdminLogger(),
                        adminPersonPatientLinkManager: new AdminPersonPatientLinkManager({
                            databaseQueryFactory: c.databaseQueryFactory,
                            databaseUpdateFactory: c.databaseUpdateFactory,
                            fhirOperationsManager: c.fhirOperationsManager,
                            postSaveProcessor: c.postSaveProcessor,
                            patientFilterManager: c.patientFilterManager
                        })
                    })
            );

            /**
             * @type {ClientPersonToProaPatientLinkRunner}
             */
            const clientPersonToProaPatientLink = container.clientPersonToProaPatientLink;
            assertTypeEquals(clientPersonToProaPatientLink, ClientPersonToProaPatientLinkRunner);
            await clientPersonToProaPatientLink.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${person1.id}`)
                .set(getHeaders())
                .expect(200);

            const person1AfterRun = resp.body;
            delete person1AfterRun.meta.lastUpdated;
            expect(person1AfterRun).toEqual(expectedPerson1AfterRun);

            resp = await request
                .get(`/4_0_0/Person/${person2.id}`)
                .set(getHeaders())
                .expect(200);

            const person2AfterRun = resp.body;
            delete person2AfterRun.meta.lastUpdated;
            expect(person2AfterRun).toEqual(expectedPerson2AfterRun);

            resp = await request
                .get(`/4_0_0/Patient/${patient1.id}`)
                .set(getHeaders())
                .expect(200);

            const patient1AfterRun = resp.body;
            delete patient1AfterRun.meta.lastUpdated;
            expect(patient1AfterRun).toEqual(expectedPatient1);

            resp = await request
                .get(`/4_0_0/Person/_history?id=${person1.id}`)
                .set(getHeaders())
                .expect(200);

            const person1History = resp.body;

            expect(person1History.entry).toBeDefined();
            expect(person1History.entry.length).toEqual(2);

            delete person1History.entry[0].resource.meta.lastUpdated;
            expect(person1History.entry[0].resource).toEqual(expectedPerson1AfterRun);

            delete person1History.entry[1].resource.meta.lastUpdated;
            expect(person1History.entry[1].resource).toEqual(expectedPerson1BeforeRun);

            resp = await request
                .get(`/4_0_0/Person/_history?id=${person2.id}`)
                .set(getHeaders())
                .expect(200);

            const person2History = resp.body;

            expect(person2History.entry).toBeDefined();
            expect(person2History.entry.length).toEqual(2);

            delete person2History.entry[0].resource.meta.lastUpdated;
            expect(person2History.entry[0].resource).toEqual(expectedPerson2AfterRun);

            delete person2History.entry[1].resource.meta.lastUpdated;
            expect(person2History.entry[1].resource).toEqual(expectedPerson2BeforeRun);
        });
    });
});
