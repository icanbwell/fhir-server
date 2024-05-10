// test file
const person1 = require('./fixtures/person/person1.json');
const person2 = require('./fixtures/person/person2.json');
const masterPerson = require('./fixtures/person/masterPerson.json');
const masterPerson1 = require('./fixtures/person/masterPerson1.json');

// expected
const expectedMasterPersonBeforeRun = require('./fixtures/expected/expectedMasterPersonBeforeRun.json');
const expectedMasterPersonAfterRun = require('./fixtures/expected/expectedMasterPersonAfterRun.json');

const expectedMasterPerson1BeforeRun = require('./fixtures/expected/expectedMasterPerson1BeforeRun.json');
const expectedMasterPerson1AfterRun = require('./fixtures/expected/expectedMasterPerson1AfterRun.json');

const expectedPerson1BeforeRun = require('./fixtures/expected/expectedPerson1BeforeRun.json');
const expectedPerson1AfterRun = require('./fixtures/expected/expectedPerson1AfterRun.json');

const expectedPerson2BeforeRun = require('./fixtures/expected/expectedPerson2BeforeRun.json');
const expectedPerson2AfterRun = require('./fixtures/expected/expectedPerson2AfterRun.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders
} = require('../../../common');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { assertTypeEquals } = require('../../../../utils/assertType');
const { DelinkProaPersonRunner } = require('../../../../admin/runners/delinkProaPersonRunner');
const {
    AdminPersonPatientLinkManager
} = require('../../../../admin/adminPersonPatientLinkManager');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Person Tests', () => {
    beforeEach(async () => {
        const container = getTestContainer();
        if (container) {
            delete container.services.delinkProaPerson;
        }
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Proa Persons Tests', () => {
        test('Proa Person is not deleted', async () => {

            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send([person1, masterPerson])
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse([
                { created: true },
                { created: true }
            ]);

            resp = await request
                .get(`/4_0_0/Person/${masterPerson.id}`)
                .set(getHeaders())
                .expect(200);

            const masterPersonBeforeRun = resp.body;
            delete masterPersonBeforeRun.meta.lastUpdated;
            expect(masterPersonBeforeRun).toEqual(expectedMasterPersonBeforeRun);

            resp = await request.get(`/4_0_0/Person/${person1.id}`).set(getHeaders()).expect(200);

            const person1BeforeRun = resp.body;
            delete person1BeforeRun.meta.lastUpdated;
            expect(person1BeforeRun).toEqual(expectedPerson1BeforeRun);

            const container = getTestContainer();

            container.register(
                'delinkProaPerson',
                (c) =>
                    new DelinkProaPersonRunner({
                        csvFileName:
                            '/src/tests/admin/runners/delinkProaPerson/fixtures/csv/test1.csv',
                        proaPatientUuidColumn: 0,
                        proaPersonUuidColumn: 1,
                        proaPersonSAAColumn: 2,
                        proaPersonLastUpdatedColumn: 3,
                        masterUuidColumn: 4,
                        clientUuidColumn: 5,
                        statusColumn: 6,
                        deleteData: false,
                        adminLogger: new AdminLogger(),
                        databaseQueryFactory: c.databaseQueryFactory,
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
             * @type {DelinkProaPersonRunner}
             */
            const delinkProaPerson = container.delinkProaPerson;
            assertTypeEquals(delinkProaPerson, DelinkProaPersonRunner);
            await delinkProaPerson.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${masterPerson.id}`)
                .set(getHeaders())
                .expect(200);

            const masterPersonAfterRun = resp.body;
            delete masterPersonAfterRun.meta.lastUpdated;
            expect(masterPersonAfterRun).toEqual(expectedMasterPersonBeforeRun);

            resp = await request
                .get(`/4_0_0/Person/${person1.id}`)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedPerson1BeforeRun);

            resp = await request
                .get(`/4_0_0/Person/${person1.id}/_history/2`)
                .set(getHeaders())
                .expect(404);

            resp = await request
                .get(`/4_0_0/Person/${masterPerson.id}/_history/2`)
                .set(getHeaders())
                .expect(404);
        });

        test('Proa Person is deleted', async () => {

            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send([person1, masterPerson])
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse([
                { created: true },
                { created: true }
            ]);

            resp = await request
                .get(`/4_0_0/Person/${masterPerson.id}`)
                .set(getHeaders())
                .expect(200);

            const masterPersonBeforeRun = resp.body;
            delete masterPersonBeforeRun.meta.lastUpdated;
            expect(masterPersonBeforeRun).toEqual(expectedMasterPersonBeforeRun);

            resp = await request.get(`/4_0_0/Person/${person1.id}`).set(getHeaders()).expect(200);

            const person1BeforeRun = resp.body;
            delete person1BeforeRun.meta.lastUpdated;
            expect(person1BeforeRun).toEqual(expectedPerson1BeforeRun);

            const container = getTestContainer();

            container.register(
                'delinkProaPerson',
                (c) =>
                    new DelinkProaPersonRunner({
                        csvFileName:
                            '/src/tests/admin/runners/delinkProaPerson/fixtures/csv/test1.csv',
                        proaPatientUuidColumn: 0,
                        proaPersonUuidColumn: 1,
                        proaPersonSAAColumn: 2,
                        proaPersonLastUpdatedColumn: 3,
                        masterUuidColumn: 4,
                        clientUuidColumn: 5,
                        statusColumn: 6,
                        deleteData: true,
                        adminLogger: new AdminLogger(),
                        databaseQueryFactory: c.databaseQueryFactory,
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
             * @type {DelinkProaPersonRunner}
             */
            const delinkProaPerson = container.delinkProaPerson;
            assertTypeEquals(delinkProaPerson, DelinkProaPersonRunner);
            await delinkProaPerson.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${masterPerson.id}`)
                .set(getHeaders())
                .expect(200);

            const masterPersonAfterRun = resp.body;
            delete masterPersonAfterRun.meta.lastUpdated;
            expect(masterPersonAfterRun).toEqual(expectedMasterPersonAfterRun);

            resp = await request.get(`/4_0_0/Person/${person1.id}`).set(getHeaders()).expect(404);

            resp = await request
                .get(`/4_0_0/Person/${person1.id}/_history/2`)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedPerson1AfterRun);

            resp = await request
                .get(`/4_0_0/Person/${person1.id}/_history/`)
                .set(getHeaders())
                .expect(200);

            const person1History = resp.body;
            expect(person1History.entry).toHaveLength(3);
            expect(person1History?.entry[1]?.request?.method).toEqual('DELETE');

            resp = await request
                .get(`/4_0_0/Person/${masterPerson.id}/_history/2`)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedMasterPersonAfterRun);
        });

        test('Proa Person is not deleted', async () => {

            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send([person2, masterPerson])
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse([
                { created: true },
                { created: true }
            ]);

            resp = await request
                .get(`/4_0_0/Person/${masterPerson.id}`)
                .set(getHeaders())
                .expect(200);

            const masterPersonBeforeRun = resp.body;
            delete masterPersonBeforeRun.meta.lastUpdated;
            expect(masterPersonBeforeRun).toEqual(expectedMasterPersonBeforeRun);

            resp = await request.get(`/4_0_0/Person/${person2.id}`).set(getHeaders()).expect(200);

            const person2BeforeRun = resp.body;
            delete person2BeforeRun.meta.lastUpdated;
            expect(person2BeforeRun).toEqual(expectedPerson2BeforeRun);

            const container = getTestContainer();

            container.register(
                'delinkProaPerson',
                (c) =>
                    new DelinkProaPersonRunner({
                        csvFileName:
                            '/src/tests/admin/runners/delinkProaPerson/fixtures/csv/test1.csv',
                        proaPatientUuidColumn: 0,
                        proaPersonUuidColumn: 1,
                        proaPersonSAAColumn: 2,
                        proaPersonLastUpdatedColumn: 3,
                        masterUuidColumn: 4,
                        clientUuidColumn: 5,
                        statusColumn: 6,
                        deleteData: true,
                        adminLogger: new AdminLogger(),
                        databaseQueryFactory: c.databaseQueryFactory,
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
             * @type {DelinkProaPersonRunner}
             */
            const delinkProaPerson = container.delinkProaPerson;
            assertTypeEquals(delinkProaPerson, DelinkProaPersonRunner);
            await delinkProaPerson.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${masterPerson.id}`)
                .set(getHeaders())
                .expect(200);

            const masterPersonAfterRun = resp.body;
            delete masterPersonAfterRun.meta.lastUpdated;
            expect(masterPersonAfterRun).toEqual(expectedMasterPersonAfterRun);

            resp = await request
                .get(`/4_0_0/Person/${person2.id}`)
                .set(getHeaders())
                .expect(200);

            const person2AfterRun = resp.body;
            delete person2AfterRun.meta.lastUpdated;
            expect(person2AfterRun).toEqual(expectedPerson2AfterRun);

            resp = await request
                .get(`/4_0_0/Person/${person2.id}/_history/2`)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedPerson2AfterRun);

            resp = await request
                .get(`/4_0_0/Person/${masterPerson.id}/_history/2`)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedMasterPersonAfterRun);
        });

        test('Proa Person with multiple master persons', async () => {

            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send([person1, masterPerson, masterPerson1])
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse([
                { created: true },
                { created: true },
                { created: true }
            ]);

            resp = await request
                .get(`/4_0_0/Person/${masterPerson.id}`)
                .set(getHeaders())
                .expect(200);

            const masterPersonBeforeRun = resp.body;
            delete masterPersonBeforeRun.meta.lastUpdated;
            expect(masterPersonBeforeRun).toEqual(expectedMasterPersonBeforeRun);

            resp = await request
                .get(`/4_0_0/Person/${masterPerson1.id}`)
                .set(getHeaders())
                .expect(200);

            const masterPerson1BeforeRun = resp.body;
            delete masterPerson1BeforeRun.meta.lastUpdated;
            expect(masterPerson1BeforeRun).toEqual(expectedMasterPerson1BeforeRun);

            resp = await request.get(`/4_0_0/Person/${person1.id}`).set(getHeaders()).expect(200);

            const person1BeforeRun = resp.body;
            delete person1BeforeRun.meta.lastUpdated;
            expect(person1BeforeRun).toEqual(expectedPerson1BeforeRun);

            const container = getTestContainer();

            container.register(
                'delinkProaPerson',
                (c) =>
                    new DelinkProaPersonRunner({
                        csvFileName:
                            '/src/tests/admin/runners/delinkProaPerson/fixtures/csv/test2.csv',
                        proaPatientUuidColumn: 0,
                        proaPersonUuidColumn: 1,
                        proaPersonSAAColumn: 2,
                        proaPersonLastUpdatedColumn: 3,
                        masterUuidColumn: 4,
                        clientUuidColumn: 5,
                        statusColumn: 6,
                        deleteData: true,
                        adminLogger: new AdminLogger(),
                        databaseQueryFactory: c.databaseQueryFactory,
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
             * @type {DelinkProaPersonRunner}
             */
            const delinkProaPerson = container.delinkProaPerson;
            assertTypeEquals(delinkProaPerson, DelinkProaPersonRunner);
            await delinkProaPerson.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${masterPerson.id}`)
                .set(getHeaders())
                .expect(200);

            const masterPersonAfterRun = resp.body;
            delete masterPersonAfterRun.meta.lastUpdated;
            expect(masterPersonAfterRun).toEqual(expectedMasterPersonAfterRun);

            resp = await request
                .get(`/4_0_0/Person/${masterPerson1.id}`)
                .set(getHeaders())
                .expect(200);

            const masterPerson1AfterRun = resp.body;
            delete masterPerson1AfterRun.meta.lastUpdated;
            expect(masterPerson1AfterRun).toEqual(expectedMasterPerson1AfterRun);

            resp = await request.get(`/4_0_0/Person/${person1.id}`).set(getHeaders()).expect(404);

            resp = await request
                .get(`/4_0_0/Person/${person1.id}/_history/2`)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedPerson1AfterRun);

            resp = await request
                .get(`/4_0_0/Person/${person1.id}/_history/`)
                .set(getHeaders())
                .expect(200);

            const person1History = resp.body;
            expect(person1History.entry).toHaveLength(3);
            expect(person1History?.entry[1]?.request?.method).toEqual('DELETE');

            resp = await request
                .get(`/4_0_0/Person/${masterPerson.id}/_history/2`)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedMasterPersonAfterRun);
        });
    });
});
