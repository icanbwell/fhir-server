const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders
} = require('../../../common');
const { AdminLogger } = require('../../../../admin/adminLogger');
const {
    AddProxyPatientToConsentResourceRunner
} = require('../../../../admin/runners/addProxyPatientToConsentResource');

// fixtures
const bwellPerson1 = require('./fixtures/person/bwellPerson1.json');
const bwellPerson2 = require('./fixtures/person/bwellPerson2.json');
const clientPerson = require('./fixtures/person/person1.json');
const client1Person = require('./fixtures/person/person2.json');
const clientPatient = require('./fixtures/patient/patient1.json');
const client1Patient = require('./fixtures/patient/patient2.json');
const consent1 = require('./fixtures/consent/consent1.json');
const consent2 = require('./fixtures/consent/consent2.json');
const consentWithActor = require('./fixtures/consent/consent_with_actor.json');
const consentWithProxyPerson = require('./fixtures/consent/consent_with_proxy_person_reference.json');
const consent2WithBwellPerson = require('./fixtures/consent/consent2_with_master_person_reference.json');
const consentWithWrongClientPerson = require('./fixtures/consent/consent_with_wrong_client_person.json');
const consentWithClientPersonAsActor = require('./fixtures/consent/consent_with_client_person.json');

// expected
const expConsent1 = require('./fixtures/expected/consent1.json');
const expConsent2 = require('./fixtures/expected/consent2.json');
const expConsentWithActor = require('./fixtures/expected/consent_with_actor.json');
const expConsentWithProxyPerson = require('./fixtures/expected/consent_with_proxy_person_reference.json');
const expConsentWithClientPersonAsActor = require('./fixtures/expected/consent_with_client_person_as_actor.json');
const expConsent2WithClientPersonAsActor = require('./fixtures/expected/consent_2_with_client_person_as_actor.json');
const expConsentWithCorrectClientPersonAsActor = require('./fixtures/expected/consent_with_correct_client_person_as_actor.json');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');

describe('Add Proxy Person link to Consent Resources Test', () => {
    beforeEach(async () => {
        const container = getTestContainer();
        if (container) {
            delete container.services.addProxyPatientToConsentResourceRunner;
        }
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('should update the consent resources when provision.actor is empty', async () => {
        const request = await createTestRequest();

        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Person/$merge')
            .send([
                bwellPerson1,
                bwellPerson2,
                client1Person,
                clientPerson,
                client1Patient,
                clientPatient,
                consent1,
                consent2
            ])
            .set(getHeaders())
            .expect(200);
        expect(resp).toHaveResourceCount(8);
        // run the script
        const container = getTestContainer();
        const collections = ['Consent_4_0_0'];
        const batchSize = 1000;

        // now add our class
        container.register(
            'addProxyPatientToConsentResourceRunner',
            (c) =>
                new AddProxyPatientToConsentResourceRunner({
                    mongoCollectionManager: c.mongoCollectionManager,
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    collections,
                    batchSize,
                    adminLogger: new AdminLogger(),
                    bwellPersonFinder: c.bwellPersonFinder,
                    preSaveManager: c.preSaveManager
                })
        );

        const addProxyPatientToConsentResourceRunner =
            container.addProxyPatientToConsentResourceRunner;
        expect(
            addProxyPatientToConsentResourceRunner instanceof AddProxyPatientToConsentResourceRunner
        );

        await addProxyPatientToConsentResourceRunner.processAsync();

        resp = await request.get('/4_0_0/Consent').set(getHeaders()).expect(200);

        expect(resp).toHaveResponse([expConsent1, expConsent2]);
    });

    test('should update the consent resources when provision.actor is not empty', async () => {
        const request = await createTestRequest();

        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Person/$merge')
            .send([
                bwellPerson1,
                bwellPerson2,
                client1Person,
                clientPerson,
                client1Patient,
                clientPatient,
                consentWithActor
            ])
            .set(getHeaders())
            .expect(200);
        expect(resp).toHaveResourceCount(7);
        // run the script
        const container = getTestContainer();
        const collections = ['Consent_4_0_0'];
        const batchSize = 1000;

        // now add our class
        container.register(
            'addProxyPatientToConsentResourceRunner',
            (c) =>
                new AddProxyPatientToConsentResourceRunner({
                    mongoCollectionManager: c.mongoCollectionManager,
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    collections,
                    batchSize,
                    adminLogger: new AdminLogger(),
                    bwellPersonFinder: c.bwellPersonFinder,
                    preSaveManager: c.preSaveManager
                })
        );

        const addProxyPatientToConsentResourceRunner =
            container.addProxyPatientToConsentResourceRunner;
        expect(
            addProxyPatientToConsentResourceRunner instanceof AddProxyPatientToConsentResourceRunner
        );

        await addProxyPatientToConsentResourceRunner.processAsync();

        resp = await request.get('/4_0_0/Consent').set(getHeaders()).expect(200);
        expect(resp).toHaveResourceCount(1);
        expect(resp).toHaveResponse([expConsentWithActor]);
    });

    test('should update the consent resources when master person reference is present', async () => {
        const request = await createTestRequest();

        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Person/$merge')
            .send([
                bwellPerson1,
                bwellPerson2,
                client1Person,
                clientPerson,
                client1Patient,
                clientPatient,
                consentWithActor,
                consentWithProxyPerson
            ])
            .set(getHeaders())
            .expect(200);
        expect(resp).toHaveResourceCount(8);
        // run the script
        const container = getTestContainer();
        const collections = ['Consent_4_0_0'];
        const batchSize = 1000;

        // now add our class
        container.register(
            'addProxyPatientToConsentResourceRunner',
            (c) =>
                new AddProxyPatientToConsentResourceRunner({
                    mongoCollectionManager: c.mongoCollectionManager,
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    collections,
                    batchSize,
                    adminLogger: new AdminLogger(),
                    bwellPersonFinder: c.bwellPersonFinder,
                    preSaveManager: c.preSaveManager
                })
        );

        const addProxyPatientToConsentResourceRunner =
            container.addProxyPatientToConsentResourceRunner;
        expect(
            addProxyPatientToConsentResourceRunner instanceof AddProxyPatientToConsentResourceRunner
        );

        await addProxyPatientToConsentResourceRunner.processAsync();

        resp = await request.get('/4_0_0/Consent').set(getHeaders()).expect(200);
        expect(resp).toHaveResourceCount(2);
        expect(resp).toHaveResponse([expConsentWithActor, expConsentWithProxyPerson]);

    });

    test('should update the consent resources only when proxy person reference is not present', async () => {
        const request = await createTestRequest();

        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Person/$merge')
            .send([
                bwellPerson1,
                bwellPerson2,
                client1Person,
                clientPerson,
                client1Patient,
                clientPatient,
                consentWithClientPersonAsActor
            ])
            .set(getHeaders())
            .expect(200);
        expect(resp).toHaveResourceCount(7);
        // run the script
        const container = getTestContainer();
        const collections = ['Consent_4_0_0'];
        const batchSize = 1000;

        // now add our class
        container.register(
            'addProxyPatientToConsentResourceRunner',
            (c) =>
                new AddProxyPatientToConsentResourceRunner({
                    mongoCollectionManager: c.mongoCollectionManager,
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    collections,
                    batchSize,
                    adminLogger: new AdminLogger(),
                    bwellPersonFinder: c.bwellPersonFinder,
                    preSaveManager: c.preSaveManager
                })
        );

        const addProxyPatientToConsentResourceRunner =
            container.addProxyPatientToConsentResourceRunner;
        expect(
            addProxyPatientToConsentResourceRunner instanceof AddProxyPatientToConsentResourceRunner
        );

        await addProxyPatientToConsentResourceRunner.processAsync();

        resp = await request.get('/4_0_0/Consent').set(getHeaders()).expect(200);
        expect(resp).toHaveResourceCount(1);
        expect(resp).toHaveResponse([expConsentWithClientPersonAsActor]);
    });

    test('should update the consent resources fill it with correct client person reference', async () => {
        const request = await createTestRequest();

        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Person/$merge')
            .send([
                bwellPerson1,
                bwellPerson2,
                client1Person,
                clientPerson,
                client1Patient,
                clientPatient,
                consentWithActor,
                consent2WithBwellPerson,
                consentWithWrongClientPerson
            ])
            .set(getHeaders())
            .expect(200);
        expect(resp).toHaveResourceCount(9);
        // run the script
        const container = getTestContainer();
        const collections = ['Consent_4_0_0'];
        const batchSize = 1000;

        // now add our class
        container.register(
            'addProxyPatientToConsentResourceRunner',
            (c) =>
                new AddProxyPatientToConsentResourceRunner({
                    mongoCollectionManager: c.mongoCollectionManager,
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    collections,
                    batchSize,
                    adminLogger: new AdminLogger(),
                    bwellPersonFinder: c.bwellPersonFinder,
                    preSaveManager: c.preSaveManager
                })
        );

        const addProxyPatientToConsentResourceRunner =
            container.addProxyPatientToConsentResourceRunner;
        expect(
            addProxyPatientToConsentResourceRunner instanceof AddProxyPatientToConsentResourceRunner
        );

        await addProxyPatientToConsentResourceRunner.processAsync();

        resp = await request.get('/4_0_0/Consent').set(getHeaders()).expect(200);
        expect(resp).toHaveResourceCount(3);
        expect(resp).toHaveResponse([
            expConsent2WithClientPersonAsActor,
            expConsentWithCorrectClientPersonAsActor,
            expConsentWithClientPersonAsActor
        ]);
    });
});
