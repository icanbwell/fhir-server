// test file
const person1 = require('./fixtures/person/person1.json');
const person2 = require('./fixtures/person/person2.json');
const masterPerson = require('./fixtures/person/masterPerson.json');
const masterPerson1 = require('./fixtures/person/masterPerson1.json');

// expected
const expectedMasterPersonBeforeRun = require('./fixtures/expected/expectedMasterPersonBeforeRun.json');

const expectedMasterPerson1BeforeRun = require('./fixtures/expected/expectedMasterPerson1BeforeRun.json');

const expectedPerson1BeforeRun = require('./fixtures/expected/expectedPerson1BeforeRun.json');

const expectedPerson2BeforeRun = require('./fixtures/expected/expectedPerson2BeforeRun.json');

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
    DelinkProaPersonMasterPersonRunner
} = require('../../../../admin/runners/delinkProaPersonMasterPersonRunner');
const {
    AdminPersonPatientLinkManager
} = require('../../../../admin/adminPersonPatientLinkManager');

const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Person Tests', () => {
    beforeEach(async () => {
        const container = getTestContainer();
        if (container) {
            delete container.services.delinkProaPersonMasterPerson;
        }
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Proa Persons Tests', () => {
        test('deleteData flag is false so nothing is deleted', async () => {

            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send([person1, masterPerson])
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

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
                'delinkProaPersonMasterPerson',
                (c) =>
                    new DelinkProaPersonMasterPersonRunner({
                        csvFileName:
                            '/src/tests/admin/runners/delinkProaPersonMasterPerson/fixtures/csv/test1.csv',
                        proaPatientUuidColumn: 0,
                        proaPersonUuidColumn: 1,
                        proaPersonSAAColumn: 2,
                        proaPersonLastUpdatedColumn: 3,
                        masterUuidColumn: 4,
                        masterPersonSAAColumn: 5,
                        masterPersonLastUpdatedColumn: 6,
                        statusColumn: 7,
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
             * @type {DelinkProaPersonMasterPersonRunner}
             */
            const delinkProaPersonMasterPerson = container.delinkProaPersonMasterPerson;
            assertTypeEquals(delinkProaPersonMasterPerson, DelinkProaPersonMasterPersonRunner);
            await delinkProaPersonMasterPerson.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${masterPerson.id}`)
                .set(getHeaders())
                .expect(200);

            resp = await request.get(`/4_0_0/Person/${person1.id}`).set(getHeaders()).expect(200);

            resp = await request
                .get(`/4_0_0/Person/${masterPerson.id}/_history/`)
                .set(getHeaders())
                .expect(200);

            const masterPersonHistory = resp.body;
            expect(masterPersonHistory.entry).toHaveLength(1);

            // Since this script doesn't delink master person to proa person history for that will not created
            resp = await request
                .get(`/4_0_0/Person/${masterPerson.id}/_history/2`)
                .set(getHeaders())
                .expect(404);
        });

        test('Master person with status Master Person Not Linked to Client Person and Master Patient is deleted', async () => {

            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send([person1, masterPerson])
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

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
                'delinkProaPersonMasterPerson',
                (c) =>
                    new DelinkProaPersonMasterPersonRunner({
                        csvFileName:
                            '/src/tests/admin/runners/delinkProaPersonMasterPerson/fixtures/csv/test1.csv',
                        proaPatientUuidColumn: 0,
                        proaPersonUuidColumn: 1,
                        proaPersonSAAColumn: 2,
                        proaPersonLastUpdatedColumn: 3,
                        masterUuidColumn: 4,
                        masterPersonSAAColumn: 5,
                        masterPersonLastUpdatedColumn: 6,
                        statusColumn: 7,
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
             * @type {DelinkProaPersonMasterPersonRunner}
             */
            const delinkProaPersonMasterPerson = container.delinkProaPersonMasterPerson;
            assertTypeEquals(delinkProaPersonMasterPerson, DelinkProaPersonMasterPersonRunner);
            await delinkProaPersonMasterPerson.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${masterPerson.id}`)
                .set(getHeaders())
                .expect(404);

            resp = await request.get(`/4_0_0/Person/${person1.id}`).set(getHeaders()).expect(200);

            resp = await request
                .get(`/4_0_0/Person/${masterPerson.id}/_history/`)
                .set(getHeaders())
                .expect(200);

            const masterPersonHistory = resp.body;
            expect(masterPersonHistory.entry).toHaveLength(2);
            expect(masterPersonHistory?.entry[1]?.request?.method).toEqual('DELETE');

            // Since this script doesn't delink master person to proa person history for that will not created
            resp = await request
                .get(`/4_0_0/Person/${masterPerson.id}/_history/2`)
                .set(getHeaders())
                .expect(404);
        });

        test('Master person with status Master Person Not Linked to Client Person is not deleted', async () => {

            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send([person1, masterPerson, masterPerson1])
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }, { created: true }]);

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
                'delinkProaPersonMasterPerson',
                (c) =>
                    new DelinkProaPersonMasterPersonRunner({
                        csvFileName:
                            '/src/tests/admin/runners/delinkProaPersonMasterPerson/fixtures/csv/test2.csv',
                        proaPatientUuidColumn: 0,
                        proaPersonUuidColumn: 1,
                        proaPersonSAAColumn: 2,
                        proaPersonLastUpdatedColumn: 3,
                        masterUuidColumn: 4,
                        masterPersonSAAColumn: 5,
                        masterPersonLastUpdatedColumn: 6,
                        statusColumn: 7,
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
             * @type {DelinkProaPersonMasterPersonRunner}
             */
            const delinkProaPersonMasterPerson = container.delinkProaPersonMasterPerson;
            assertTypeEquals(delinkProaPersonMasterPerson, DelinkProaPersonMasterPersonRunner);
            await delinkProaPersonMasterPerson.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${masterPerson.id}`)
                .set(getHeaders())
                .expect(404);

            resp = await request
                .get(`/4_0_0/Person/${masterPerson1.id}`)
                .set(getHeaders())
                .expect(200);

            const masterPerson1AfterRun = resp.body;
            delete masterPerson1AfterRun.meta.lastUpdated;
            expect(masterPerson1AfterRun).toEqual(expectedMasterPerson1BeforeRun);

            resp = await request.get(`/4_0_0/Person/${person1.id}`).set(getHeaders()).expect(200);

            resp = await request
                .get(`/4_0_0/Person/${masterPerson.id}/_history/`)
                .set(getHeaders())
                .expect(200);

            const masterPersonHistory = resp.body;
            expect(masterPersonHistory.entry).toHaveLength(2);
            expect(masterPersonHistory?.entry[1]?.request?.method).toEqual('DELETE');

            // Since this script doesn't delink master person to proa person history for that will not created
            resp = await request
                .get(`/4_0_0/Person/${masterPerson.id}/_history/2`)
                .set(getHeaders())
                .expect(404);
        });

        test('Proa Person with status Proa Person not linked to master person is deleted', async () => {

            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send([person1, person2])
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request.get(`/4_0_0/Person/${person1.id}`).set(getHeaders()).expect(200);

            const person1BeforeRun = resp.body;
            delete person1BeforeRun.meta.lastUpdated;
            expect(person1BeforeRun).toEqual(expectedPerson1BeforeRun);

            resp = await request.get(`/4_0_0/Person/${person2.id}`).set(getHeaders()).expect(200);

            const person2BeforeRun = resp.body;
            delete person2BeforeRun.meta.lastUpdated;
            expect(person2BeforeRun).toEqual(expectedPerson2BeforeRun);

            const container = getTestContainer();

            container.register(
                'delinkProaPersonMasterPerson',
                (c) =>
                    new DelinkProaPersonMasterPersonRunner({
                        csvFileName:
                            '/src/tests/admin/runners/delinkProaPersonMasterPerson/fixtures/csv/test3.csv',
                        proaPatientUuidColumn: 0,
                        proaPersonUuidColumn: 1,
                        proaPersonSAAColumn: 2,
                        proaPersonLastUpdatedColumn: 3,
                        masterUuidColumn: 4,
                        masterPersonSAAColumn: 5,
                        masterPersonLastUpdatedColumn: 6,
                        statusColumn: 7,
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
             * @type {DelinkProaPersonMasterPersonRunner}
             */
            const delinkProaPersonMasterPerson = container.delinkProaPersonMasterPerson;
            assertTypeEquals(delinkProaPersonMasterPerson, DelinkProaPersonMasterPersonRunner);
            await delinkProaPersonMasterPerson.processAsync();

            resp = await request.get(`/4_0_0/Person/${person1.id}`).set(getHeaders()).expect(404);

            resp = await request.get(`/4_0_0/Person/${person2.id}`).set(getHeaders()).expect(200);

            resp = await request.get(`/4_0_0/Person/${person1.id}/_history`).set(getHeaders()).expect(200);
            const person1History = resp.body;
            expect(person1History.entry).toHaveLength(2);
            expect(person1History?.entry[1]?.request?.method).toEqual('DELETE');

            resp = await request.get(`/4_0_0/Person/${person2.id}/_history`).set(getHeaders()).expect(200);
            const person2History = resp.body;
            expect(person2History?.entry).toHaveLength(1);
        });

        test('Proa Person with links present is not deleted', async () => {

            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send([person1, person2])
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request.get(`/4_0_0/Person/${person1.id}`).set(getHeaders()).expect(200);

            const person1BeforeRun = resp.body;
            delete person1BeforeRun.meta.lastUpdated;
            expect(person1BeforeRun).toEqual(expectedPerson1BeforeRun);

            resp = await request.get(`/4_0_0/Person/${person2.id}`).set(getHeaders()).expect(200);

            const person2BeforeRun = resp.body;
            delete person2BeforeRun.meta.lastUpdated;
            expect(person2BeforeRun).toEqual(expectedPerson2BeforeRun);

            const container = getTestContainer();

            container.register(
                'delinkProaPersonMasterPerson',
                (c) =>
                    new DelinkProaPersonMasterPersonRunner({
                        csvFileName:
                            '/src/tests/admin/runners/delinkProaPersonMasterPerson/fixtures/csv/test4.csv',
                        proaPatientUuidColumn: 0,
                        proaPersonUuidColumn: 1,
                        proaPersonSAAColumn: 2,
                        proaPersonLastUpdatedColumn: 3,
                        masterUuidColumn: 4,
                        masterPersonSAAColumn: 5,
                        masterPersonLastUpdatedColumn: 6,
                        statusColumn: 7,
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
             * @type {DelinkProaPersonMasterPersonRunner}
             */
            const delinkProaPersonMasterPerson = container.delinkProaPersonMasterPerson;
            assertTypeEquals(delinkProaPersonMasterPerson, DelinkProaPersonMasterPersonRunner);
            await delinkProaPersonMasterPerson.processAsync();

            resp = await request.get(`/4_0_0/Person/${person1.id}`).set(getHeaders()).expect(404);

            resp = await request.get(`/4_0_0/Person/${person2.id}`).set(getHeaders()).expect(200);

            resp = await request.get(`/4_0_0/Person/${person1.id}/_history`).set(getHeaders()).expect(200);
            const person1History = resp.body;
            expect(person1History.entry).toHaveLength(2);
            expect(person1History?.entry[1]?.request?.method).toEqual('DELETE');

            resp = await request.get(`/4_0_0/Person/${person2.id}/_history`).set(getHeaders()).expect(200);
            const person2History = resp.body;
            expect(person2History?.entry).toHaveLength(1);
        });

        test('Csv contains client person status so nothing is done', async () => {

            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send([person1, person2, masterPerson1, masterPerson])
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }, { created: true }, { created: true }]);

            resp = await request.get(`/4_0_0/Person/${person1.id}`).set(getHeaders()).expect(200);

            const person1BeforeRun = resp.body;
            delete person1BeforeRun.meta.lastUpdated;
            expect(person1BeforeRun).toEqual(expectedPerson1BeforeRun);

            resp = await request.get(`/4_0_0/Person/${person2.id}`).set(getHeaders()).expect(200);

            const person2BeforeRun = resp.body;
            delete person2BeforeRun.meta.lastUpdated;
            expect(person2BeforeRun).toEqual(expectedPerson2BeforeRun);

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

            const container = getTestContainer();

            container.register(
                'delinkProaPersonMasterPerson',
                (c) =>
                    new DelinkProaPersonMasterPersonRunner({
                        csvFileName:
                            '/src/tests/admin/runners/delinkProaPersonMasterPerson/fixtures/csv/test5.csv',
                        proaPatientUuidColumn: 0,
                        proaPersonUuidColumn: 1,
                        proaPersonSAAColumn: 2,
                        proaPersonLastUpdatedColumn: 3,
                        masterUuidColumn: 4,
                        masterPersonSAAColumn: 5,
                        masterPersonLastUpdatedColumn: 6,
                        statusColumn: 7,
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
             * @type {DelinkProaPersonMasterPersonRunner}
             */
            const delinkProaPersonMasterPerson = container.delinkProaPersonMasterPerson;
            assertTypeEquals(delinkProaPersonMasterPerson, DelinkProaPersonMasterPersonRunner);
            await delinkProaPersonMasterPerson.processAsync();

            resp = await request.get(`/4_0_0/Person/${person1.id}`).set(getHeaders()).expect(200);

            resp = await request.get(`/4_0_0/Person/${person2.id}`).set(getHeaders()).expect(200);

            resp = await request.get(`/4_0_0/Person/${person1.id}/_history`).set(getHeaders()).expect(200);
            const person1History = resp.body;
            expect(person1History?.entry).toHaveLength(1);

            resp = await request.get(`/4_0_0/Person/${person2.id}/_history`).set(getHeaders()).expect(200);
            const person2History = resp.body;
            expect(person2History?.entry).toHaveLength(1);

            resp = await request.get(`/4_0_0/Person/${masterPerson.id}`).set(getHeaders()).expect(200);

            resp = await request.get(`/4_0_0/Person/${masterPerson1.id}`).set(getHeaders()).expect(200);

            resp = await request.get(`/4_0_0/Person/${masterPerson.id}/_history`).set(getHeaders()).expect(200);
            const masterPersonHistory = resp.body;
            expect(masterPersonHistory?.entry).toHaveLength(1);

            resp = await request.get(`/4_0_0/Person/${masterPerson1.id}/_history`).set(getHeaders()).expect(200);
            const masterPerson1History = resp.body;
            expect(masterPerson1History?.entry).toHaveLength(1);
        });
    });
});
