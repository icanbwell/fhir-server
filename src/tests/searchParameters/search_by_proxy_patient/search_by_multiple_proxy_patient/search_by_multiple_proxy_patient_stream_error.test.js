// test file
const patient1 = require('./fixtures/Patient/p1.json');
const patient2 = require('./fixtures/Patient/p2.json');
const patient3 = require('./fixtures/Patient/p3.json');
const patient4 = require('./fixtures/Patient/p4.json');

const bwellPerson1 = require('./fixtures/Person/bwellPerson1.json');
const bwellPerson2 = require('./fixtures/Person/bwellPerson2.json');
const clientPerson1 = require('./fixtures/Person/clientPerson1.json');
const clientPerson2 = require('./fixtures/Person/clientPerson2.json');

const observation1 = require('./fixtures/Observations/observation1.json');
const observation2 = require('./fixtures/Observations/observation2.json');
const observation3 = require('./fixtures/Observations/observation3.json');
const observation4 = require('./fixtures/Observations/observation4.json');

// expected
const expectedResponseWithError = require('./expected/expectedStreamError.json');
// const expectedObservationsWithProxyPatients = require('./expected/expectedObservationWithProxyPatient.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../../common');
const { describe, beforeEach, afterEach, test, jest, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../../utils/configManager');
const { IdEnrichmentProvider } = require('../../../../enrich/providers/idEnrichmentProvider');

class MockConfigManager extends ConfigManager {
    get enableGlobalIdSupport () {
        return true;
    }

    get enableReturnBundle () {
        return true;
    }

    get supportLegacyIds () {
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
        const idEnrichmentEnrichSpy = jest.spyOn(IdEnrichmentProvider.prototype, 'enrichAsync');

        beforeEach(() => {
            idEnrichmentEnrichSpy.mockImplementationOnce(() => {
                throw new Error('Error while enriching');
            });
        });

        test('search observation by proxy-patient stream error should be handled correctly', async () => {
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
                    clientPerson1,
                    clientPerson2,
                    patient1,
                    patient2,
                    patient3,
                    patient4,
                    observation1,
                    observation2,
                    observation3,
                    observation4
                ])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
            // ACT & ASSERT
            // search by token system and code and make sure we get the right Patient back
            resp = await request
                .get(
                    '/4_0_0/Observation/?patient=Patient/person.54808e62-6445-4bb6-8f89-b2ed7e6865d2'
                )
                .set(getHeaders());
            expect(resp).toHaveResponse(expectedResponseWithError, (resource) => {
                resource?.issue?.forEach((i) => {
                    // delete the stack trace
                    delete i.diagnostics;
                });
                return resource;
            });
            expect(idEnrichmentEnrichSpy).toHaveBeenCalledTimes(2);
        });
    });
});
