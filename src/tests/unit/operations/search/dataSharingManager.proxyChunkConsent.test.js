'use strict';

/**
 * Consent for Person proxy-patient references across $everything batches.
 *
 * A batch that holds only the Person's proxy id (Patient/person.<id>) gets no consent branch from
 * updateQueryConsideringDataSharing, for every patient-related resource type. The batch builder
 * getEverythingIdChunks must therefore never leave the proxy id alone in a batch.
 */

const { describe, beforeEach, test, expect, jest } = require('@jest/globals');

const { DataSharingManager } = require('../../../../operations/search/dataSharingManager');
const { getEverythingIdChunks } = require('../../../../operations/everything/everythingHelper');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { ConfigManager } = require('../../../../utils/configManager');
const { PatientFilterManager } = require('../../../../fhir/patientFilterManager');
const { SearchQueryBuilder } = require('../../../../operations/search/searchQueryBuilder');
const { BwellPersonFinder } = require('../../../../utils/bwellPersonFinder');
const { ProaConsentManager } = require('../../../../operations/search/proaConsentManager');
const { CmsConsentManager } = require('../../../../operations/search/cmsConsentManager');
const { RequestSpecificCache } = require('../../../../utils/requestSpecificCache');
const { DelegatedAccessRulesManager } = require('../../../../utils/delegatedAccessRulesManager');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');

jest.mock('express-http-context', () => ({
    set: jest.fn(),
    get: jest.fn()
}));

jest.mock('../../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logWarn: jest.fn()
}));

jest.mock('../../../../operations/common/systemEventLogging', () => ({
    logTraceSystemEventAsync: jest.fn(),
    logSystemEventAsync: jest.fn()
}));

const PATIENT_UUID = 'bb7862e6-b7ac-470e-bde3-e85cee9d1ce7';
const PERSON_UUID = '33226ded-51e8-590e-8342-1197955a2af7';
const PROXY_ID = `person.${PERSON_UUID}`;
const UNCHANGED_QUERY = {
    'meta.security': {
        $elemMatch: { system: 'https://www.icanbwell.com/access', code: { $in: ['client'] } }
    }
};
const PATIENT_RELATED_TYPES = [
    'Composition',
    'Observation',
    'DocumentReference',
    'Condition',
    'Encounter',
    'Procedure',
    'MedicationStatement',
    'CareTeam'
];

/**
 * @param {string[]} ids
 * @returns {ParsedArgs}
 */
function buildParsedArgs(ids) {
    const parsedArgs = Object.create(ParsedArgs.prototype);
    const regenerateValueFromValues = jest.fn().mockReturnValue('x');
    const item = {
        propertyObj: { target: ['Patient'] },
        references: ids.map((id) => ({ resourceType: 'Patient', id })),
        queryParameter: 'patient',
        queryParameterValue: {
            values: ids.map((id) => `Patient/${id}`),
            operator: '$or',
            regenerateValueFromValues
        },
        modifiers: []
    };
    parsedArgs.regenerateValueFromValues = regenerateValueFromValues;
    parsedArgs.parsedArgItems = [item];
    parsedArgs.base_version = '4_0_0';
    parsedArgs.clone = jest.fn().mockReturnValue({ parsedArgItems: [{ ...item }] });
    return parsedArgs;
}

describe('DataSharingManager consent for proxy-patient references across batches', () => {
    let dataSharingManager;

    beforeEach(() => {
        const configManager = Object.create(ConfigManager.prototype);
        Object.defineProperty(configManager, 'enableConsentedProaDataAccess', {
            value: true,
            writable: true,
            configurable: true
        });
        Object.defineProperty(configManager, 'getConsentConnectionTypesList', {
            value: ['proa', 'ias'],
            writable: true,
            configurable: true
        });
        Object.defineProperty(configManager, 'getDataSharingConsentCodes', {
            value: ['proaConsent'],
            writable: true,
            configurable: true
        });

        const patientFilterManager = new PatientFilterManager({ configManager });

        const searchQueryBuilder = Object.create(SearchQueryBuilder.prototype);
        searchQueryBuilder.buildSearchQueryBasedOnVersion = jest
            .fn()
            .mockReturnValue({ query: { 'subject._uuid': PATIENT_UUID } });

        const bwellPersonFinder = Object.create(BwellPersonFinder.prototype);
        bwellPersonFinder.getImmediatePersonIdsOfPatientsAsync = jest.fn(
            ({ patientReferences }) => {
                const realPatients = patientReferences.filter(
                    (r) => r.id && !r.id.includes('person.')
                );
                const patientReferenceToPersonUuid = {};
                realPatients.forEach((r) => {
                    patientReferenceToPersonUuid[r.id] = [PERSON_UUID];
                });
                return Promise.resolve({
                    patientReferenceToPersonUuid,
                    personToLinkedPatientsMap: new Map([
                        [PERSON_UUID, realPatients.map((r) => `Patient/${r.id}`)]
                    ])
                });
            }
        );

        const consentCursor = {
            hint: jest.fn().mockReturnThis(),
            sort: jest.fn().mockReturnThis(),
            toArrayAsync: jest.fn().mockResolvedValue([
                {
                    patient: { _uuid: `Patient/${PATIENT_UUID}` },
                    meta: { versionId: '1', lastUpdated: '2024-01-01' }
                }
            ])
        };
        const databaseQueryFactory = Object.create(DatabaseQueryFactory.prototype);
        databaseQueryFactory.createQuery = jest.fn(({ resourceType }) => {
            if (resourceType === 'Patient') {
                return {
                    findAsync: jest.fn().mockResolvedValue({
                        hasNext: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
                        next: jest.fn().mockResolvedValue({
                            id: PATIENT_UUID,
                            _sourceId: PATIENT_UUID,
                            _uuid: PATIENT_UUID,
                            meta: {
                                security: [
                                    {
                                        system: 'https://www.icanbwell.com/connectionType',
                                        code: 'proa'
                                    }
                                ]
                            }
                        })
                    })
                };
            }
            return { findAsync: jest.fn().mockResolvedValue(consentCursor) };
        });

        dataSharingManager = new DataSharingManager({
            databaseQueryFactory,
            configManager,
            patientFilterManager,
            searchQueryBuilder,
            bwellPersonFinder,
            proaConsentManager: new ProaConsentManager({ databaseQueryFactory, configManager }),
            cmsConsentManager: Object.create(CmsConsentManager.prototype),
            requestSpecificCache: new RequestSpecificCache(),
            delegatedAccessRulesManager: Object.create(DelegatedAccessRulesManager.prototype)
        });
    });

    /**
     * Runs the consent query rewrite for one batch of ids.
     * @param {string} resourceType
     * @param {string[]} ids
     * @returns {Promise<{query: object, consentedPatientValues: string[] | undefined}>} the rewritten query and
     *   the Patient references the consented branch was rebuilt with (undefined when there is no consented branch)
     */
    const updateQuery = async (resourceType, ids) => {
        const parsedArgs = buildParsedArgs(ids);
        const query = await dataSharingManager.updateQueryConsideringDataSharing({
            base_version: '4_0_0',
            resourceType,
            parsedArgs,
            securityTags: ['client'],
            query: UNCHANGED_QUERY,
            useHistoryTable: false,
            requestId: undefined,
            isUser: false,
            allowConsentedProaDataAccess: true
        });
        const [firstCall] = parsedArgs.regenerateValueFromValues.mock.calls;
        return { query, consentedPatientValues: firstCall && firstCall[0] };
    };

    test.each(PATIENT_RELATED_TYPES)(
        '%s: a batch with a real Patient and the proxy id keeps both in the consent branch',
        async (resourceType) => {
            const { query, consentedPatientValues } = await updateQuery(resourceType, [
                PATIENT_UUID,
                PROXY_ID
            ]);

            expect(query.$or).toHaveLength(2);
            expect(consentedPatientValues).toEqual([
                `Patient/${PATIENT_UUID}`,
                `Patient/${PROXY_ID}`
            ]);
        }
    );

    test.each(PATIENT_RELATED_TYPES)(
        '%s: a batch holding only the proxy id gets no consent branch',
        async (resourceType) => {
            const { query, consentedPatientValues } = await updateQuery(resourceType, [PROXY_ID]);

            expect(query).toEqual(UNCHANGED_QUERY);
            expect(consentedPatientValues).toBeUndefined();
        }
    );

    test.each(PATIENT_RELATED_TYPES)(
        '%s: every batch built for a Person with one linked Patient keeps the proxy id with a real Patient',
        async (resourceType) => {
            const batches = getEverythingIdChunks([PATIENT_UUID, PROXY_ID], 1);

            for (const batch of batches) {
                const { consentedPatientValues } = await updateQuery(resourceType, batch);
                expect(consentedPatientValues).toEqual([
                    `Patient/${PATIENT_UUID}`,
                    `Patient/${PROXY_ID}`
                ]);
            }
        }
    );
});
