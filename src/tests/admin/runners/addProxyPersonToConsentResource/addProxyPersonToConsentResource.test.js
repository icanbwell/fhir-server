const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders,
} = require('../../../common');
const { AdminLogger } = require('../../../../admin/adminLogger');
const {
    AddProxyPatientToConsentResourceRunner,
} = require('../../../../admin/runners/addProxyPatientToConsentResource');

// fixtures
const bwellPerson1 = require('./fixtures/person/bwellPerson1.json');
const bwellPerson2 = require('./fixtures/person/bwellPerson2.json');
const medstartPerson = require('./fixtures/person/person1.json');
const walgreensPerson = require('./fixtures/person/person2.json');
const medstartPatient = require('./fixtures/patient/patient1.json');
const walgreensPatient = require('./fixtures/patient/patient2.json');
const consent1 = require('./fixtures/consent/consent1.json');
const consent2 = require('./fixtures/consent/consent2.json');
const consentWithActor = require('./fixtures/consent/consent_with_actor.json');
const consentWithProxyPerson = require('./fixtures/consent/consent_with_proxy_person_reference.json');

// expected
const expConsent1 = require('./fixtures/expected/consent1.json');
const expConsent2 = require('./fixtures/expected/consent2.json');
const expConsentWithActor = require('./fixtures/expected/consent_with_actor.json');
const expConsentWithProxyPerson = require('./fixtures/expected/consent_with_proxy_person_reference.json');

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
                walgreensPerson,
                medstartPerson,
                walgreensPatient,
                medstartPatient,
                consent1,
                consent2,
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
                    preSaveManager: c.preSaveManager,
                })
        );

        const addProxyPatientToConsentResourceRunner =
            container.addProxyPatientToConsentResourceRunner;
        expect(
            typeof addProxyPatientToConsentResourceRunner === AddProxyPatientToConsentResourceRunner
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
                walgreensPerson,
                medstartPerson,
                walgreensPatient,
                medstartPatient,
                consentWithActor,
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
                    preSaveManager: c.preSaveManager,
                })
        );

        const addProxyPatientToConsentResourceRunner =
            container.addProxyPatientToConsentResourceRunner;
        expect(
            typeof addProxyPatientToConsentResourceRunner === AddProxyPatientToConsentResourceRunner
        );

        await addProxyPatientToConsentResourceRunner.processAsync();

        resp = await request.get('/4_0_0/Consent').set(getHeaders()).expect(200);
        expect(resp).toHaveResourceCount(1);
        expect(resp).toHaveResponse([expConsentWithActor]);

        console.log(JSON.stringify(JSON.parse(resp.text), undefined, '\t'));
    });

    test('should update the consent resources only when proxy person reference is not present', async () => {
        const request = await createTestRequest();

        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Person/$merge')
            .send([
                bwellPerson1,
                bwellPerson2,
                walgreensPerson,
                medstartPerson,
                walgreensPatient,
                medstartPatient,
                consentWithActor,
                consentWithProxyPerson,
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
                    preSaveManager: c.preSaveManager,
                })
        );

        const addProxyPatientToConsentResourceRunner =
            container.addProxyPatientToConsentResourceRunner;
        expect(
            typeof addProxyPatientToConsentResourceRunner === AddProxyPatientToConsentResourceRunner
        );

        await addProxyPatientToConsentResourceRunner.processAsync();

        resp = await request.get('/4_0_0/Consent').set(getHeaders()).expect(200);
        expect(resp).toHaveResourceCount(2);
        expect(resp).toHaveResponse([expConsentWithActor, expConsentWithProxyPerson]);

        console.log(JSON.stringify(JSON.parse(resp.text), undefined, '\t'));
    });
});
