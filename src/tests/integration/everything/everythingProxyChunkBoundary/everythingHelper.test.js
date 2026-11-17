'use strict';

/**
 * A consenting client's Person/$everything must return the data that references the Person's proxy
 * patient (Patient/person.<personUuid>), whatever the number of Patients linked to the Person.
 * The proxy id is the last id in the expanded list, so at 10, 20 or 30 linked Patients it used to
 * land alone in the final batch, which gets no consent branch.
 */

const deepcopy = require('deepcopy');
const masterPerson = require('../../consented_data/consented_data/fixtures/person/master_person.json');
const clientPerson = require('../../consented_data/consented_data/fixtures/person/client_person.json');
const masterPatient = require('../../consented_data/consented_data/fixtures/patient/master_patient.json');
const clientPatient = require('../../consented_data/consented_data/fixtures/patient/client_patient.json');
const proaPatient = require('../../consented_data/consented_data/fixtures/patient/proa_patient.json');
const proaObservation = require('../../consented_data/consented_data/fixtures/observation/proa_observation.json');
const consentGiven = require('../../consented_data/consented_data/fixtures/consent/consent_given.json');
const consentDenied = require('../../consented_data/consented_data/fixtures/consent/consent_denied.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, jest, expect } = require('@jest/globals');
const { DatabaseCursor } = require('../../../../dataLayer/databaseCursor');

const CLIENT_PERSON_UUID = '33226ded-51e8-590e-8342-1197955a2af7';
const PROXY_OBSERVATION_ID = 'everythingproxyboundary-obs';
const headers = { ...getHeaders('user/*.read access/client.*'), prefer: 'global_id=false' };
const otherTenantHeaders = {
    ...getHeaders('user/*.read access/other.*'),
    prefer: 'global_id=false'
};

/**
 * Builds a client Person linked to exactly linkedPatientCount Patients (the client Patient, the PROA
 * Patient and generated PROA Patients), and a PROA observation that references the Person's proxy
 * patient.
 * @param {number} linkedPatientCount
 */
function buildFixtures(linkedPatientCount) {
    const person = deepcopy(clientPerson);
    person.link = [
        {
            target: { reference: `Patient/${clientPatient.id}`, type: 'Patient' },
            assurance: 'level4'
        },
        {
            target: { reference: `Patient/${proaPatient.id}|proa`, type: 'Patient' },
            assurance: 'level4'
        }
    ];
    const extraPatients = [];
    for (let i = 0; i < linkedPatientCount - 2; i++) {
        const patient = deepcopy(proaPatient);
        patient.id = `everythingproxyboundary-proa-${String(i).padStart(2, '0')}`;
        extraPatients.push(patient);
        person.link.push({
            target: { reference: `Patient/${patient.id}|proa`, type: 'Patient' },
            assurance: 'level4'
        });
    }
    const proxyObservation = deepcopy(proaObservation);
    proxyObservation.id = PROXY_OBSERVATION_ID;
    proxyObservation.subject = { reference: `Patient/person.${CLIENT_PERSON_UUID}` };
    return { person, extraPatients, proxyObservation };
}

const LINKED_PATIENT_COUNTS = [3, 9, 10, 11, 12, 19, 20, 21, 29, 30, 31];
const BOUNDARY_AND_NEIGHBOUR_COUNTS = [9, 10, 11, 20, 30];
const BOUNDARY_COUNTS = [10, 20, 30];

describe('Person $everything and proxy-referenced data at batch boundaries', () => {
    let hintSpy;

    beforeEach(async () => {
        hintSpy = jest.spyOn(DatabaseCursor.prototype, 'hint').mockReturnThis();
        await commonBeforeEach();
    });

    afterEach(async () => {
        hintSpy.mockRestore();
        await commonAfterEach();
    });

    /**
     * Merges the fixtures for a Person with linkedPatientCount linked Patients and the given
     * consent, then runs $everything as the given caller and returns the response status and the
     * ids it returned.
     * @param {number} linkedPatientCount
     * @param {object} consent
     * @param {object} callerHeaders
     * @returns {Promise<{status: number, ids: string[]}>}
     */
    async function everythingResult(linkedPatientCount, consent, callerHeaders = headers) {
        const { person, extraPatients, proxyObservation } = buildFixtures(linkedPatientCount);
        const request = await createTestRequest();
        const merge = await request
            .post('/4_0_0/Person/1/$merge')
            .send([
                masterPerson,
                person,
                masterPatient,
                clientPatient,
                proaPatient,
                ...extraPatients,
                proxyObservation,
                consent
            ])
            .set(getHeaders());
        expect(merge).toHaveMergeResponse({ created: true });

        const resp = await request
            .get(`/4_0_0/Person/${CLIENT_PERSON_UUID}/$everything`)
            .set(callerHeaders);

        return {
            status: resp.status,
            ids: ((resp.body && resp.body.entry) || []).map((e) => e.resource && e.resource.id)
        };
    }

    /**
     * @param {number} linkedPatientCount
     * @param {object} consent
     * @returns {Promise<string[]>} the ids $everything returned to the client
     */
    async function everythingIds(linkedPatientCount, consent) {
        const { status, ids } = await everythingResult(linkedPatientCount, consent);
        expect(status).toBe(200);
        return ids;
    }

    test.each(LINKED_PATIENT_COUNTS.map((count) => [count]))(
        'with consent given and %i linked Patients the proxy-referenced observation is returned',
        async (linkedPatientCount) => {
            const ids = await everythingIds(linkedPatientCount, consentGiven);

            expect(ids).toContain(PROXY_OBSERVATION_ID);
        }
    );

    test.each(BOUNDARY_AND_NEIGHBOUR_COUNTS.map((count) => [count]))(
        'with consent denied and %i linked Patients the proxy-referenced observation is not returned',
        async (linkedPatientCount) => {
            const ids = await everythingIds(linkedPatientCount, consentDenied);

            expect(ids).not.toContain(PROXY_OBSERVATION_ID);
        }
    );

    test.each(BOUNDARY_COUNTS.map((count) => [count]))(
        'with consent given, a caller without the owner access tag gets none of the Person data at %i linked Patients',
        async (linkedPatientCount) => {
            const { status, ids } = await everythingResult(
                linkedPatientCount,
                consentGiven,
                otherTenantHeaders
            );

            expect(status).toBe(200);
            expect(ids).toEqual([]);
        }
    );
});
