/**
 * Regression tests for docs/resource-authorization.md §8 "Tag-based filters independent of the
 * tenant/consent model".
 *
 * Claims under test, verified against the REAL implementation (no inline stand-ins):
 *   1. The `hidden` tag (meta.tag, system .../CodeSystem/server-behavior, code `hidden`) is
 *      excluded from every search by R4SearchQueryCreator.buildR4SearchQuery
 *      (src/operations/query/r4.js), UNLESS any one of the following holds: an id lookup
 *      (parsedArgs.id set), _includeHidden=true, the DELETE operation, useHistoryTable, or
 *      resourceType === 'AuditEvent'. The exact condition read from r4.js is:
 *        !parsedArgs.id && !isTrue(parsedArgs._includeHidden) && operation !== DELETE &&
 *        !useHistoryTable && resourceType !== 'AuditEvent'
 *   2. DataSharingManager.getConnectionTypeFilteredQuery (src/operations/search/dataSharingManager.js)
 *      restricts the PROA/IAS consent-driven query branch to an allow-listed set of connection
 *      types. The allow-list itself comes from ConfigManager.getConsentConnectionTypesList (env
 *      CONSENT_CONNECTION_TYPES_LIST, comma-separated, defaulting to ['proa']). That list is used
 *      in two real places:
 *        a. DataSharingManager.filterPatientsByConnectionType removes any patient id from the
 *           allowed-patient set whose recorded connectionType security tag is not in the list.
 *        b. DataSharingManager.getConnectionTypeFilteredQuery ANDs a
 *           `meta.security: { $elemMatch: { system: '.../connectionType', code: { $in: <list> } } }`
 *           clause onto the reconstructed query, so only resources carrying an allow-listed
 *           connectionType tag can match through this branch.
 */
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../utils/assertType', () => ({
    assertIsValid: () => {},
    assertTypeEquals: () => {}
}));

const { R4SearchQueryCreator } = require('../../../operations/query/r4');
const { SearchQueryBuilder } = require('../../../operations/search/searchQueryBuilder');
const { DataSharingManager } = require('../../../operations/search/dataSharingManager');
const { ConfigManager } = require('../../../utils/configManager');
const { ParsedArgs } = require('../../../operations/query/parsedArgs');
const { ParsedArgsItem } = require('../../../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../../../operations/query/queryParameterValue');
const { SearchParameterDefinition } = require('../../../searchParameters/searchParameterTypes');
const { OPERATIONS, RESOURCE_HIDDEN_TAG } = require('../../../constants');

/**
 * Creates a minimal R4SearchQueryCreator with lightweight stand-in collaborators.
 * assertType is mocked above, so these don't need to be real prototype chains.
 */
function createR4SearchQueryCreator () {
    return new R4SearchQueryCreator({
        configManager: { useAccessIndex: false },
        accessIndexManager: { resourceHasAccessIndexForAccessCodes: () => false },
        r4ArgsParser: {}
    });
}

/**
 * Creates a DataSharingManager with lightweight stand-ins for every collaborator that
 * getConnectionTypeFilteredQuery / filterPatientsByConnectionType don't actually exercise,
 * optionally overriding the searchQueryBuilder with a real one.
 */
function createDataSharingManager ({ searchQueryBuilder } = {}) {
    return new DataSharingManager({
        databaseQueryFactory: {},
        configManager: {},
        patientFilterManager: {},
        searchQueryBuilder: searchQueryBuilder || {},
        bwellPersonFinder: {},
        proaConsentManager: {},
        cmsConsentManager: {},
        requestSpecificCache: {},
        delegatedAccessRulesManager: {}
    });
}

describe('Tag-based filters independent of the tenant/consent model (doc §8)', () => {
    describe('`hidden` tag filter - R4SearchQueryCreator.buildR4SearchQuery / RESOURCE_HIDDEN_TAG', () => {
        /** @type {R4SearchQueryCreator} */
        let creator;

        beforeEach(() => {
            creator = createR4SearchQueryCreator();
        });

        /**
         * Builds an `_id` ParsedArgsItem. Adding this to a ParsedArgs makes `parsedArgs.id` truthy
         * (see ParsedArgs.add's special-case Object.defineProperty for the '_id' property name).
         */
        function idParsedArgsItem (value) {
            return new ParsedArgsItem({
                queryParameter: '_id',
                queryParameterValue: new QueryParameterValue({ value, operator: '$and' }),
                propertyObj: new SearchParameterDefinition({ type: 'token', field: 'id', fields: ['id'] }),
                modifiers: []
            });
        }

        /**
         * Builds an `_includeHidden` ParsedArgsItem so that `parsedArgs._includeHidden` resolves
         * to the given value string.
         */
        function includeHiddenParsedArgsItem (value) {
            return new ParsedArgsItem({
                queryParameter: '_includeHidden',
                queryParameterValue: new QueryParameterValue({ value, operator: '$and' }),
                propertyObj: undefined,
                modifiers: []
            });
        }

        /**
         * Locates the hidden-tag exclusion clause in a built query, regardless of whether the
         * MongoQuerySimplifier left it at the top level (only condition) or nested under $and.
         */
        function findHiddenTagClause (query) {
            if (query['meta.tag']) {
                return query['meta.tag'];
            }
            const andSegments = query.$and || [];
            const match = andSegments.find((seg) => seg && seg['meta.tag']);
            return match && match['meta.tag'];
        }

        test.each([
            [
                'present by default (plain search, no id/includeHidden/DELETE/history/AuditEvent)',
                { resourceType: 'Patient', parsedArgItems: [], operation: OPERATIONS.READ, useHistoryTable: false },
                true
            ],
            [
                'absent for an id lookup (parsedArgs.id is set)',
                {
                    resourceType: 'Patient',
                    parsedArgItems: [idParsedArgsItem('abc123')],
                    operation: OPERATIONS.READ,
                    useHistoryTable: false
                },
                false
            ],
            [
                'absent when _includeHidden=true is passed',
                {
                    resourceType: 'Patient',
                    parsedArgItems: [includeHiddenParsedArgsItem('true')],
                    operation: OPERATIONS.READ,
                    useHistoryTable: false
                },
                false
            ],
            [
                'absent for the DELETE operation',
                { resourceType: 'Patient', parsedArgItems: [], operation: OPERATIONS.DELETE, useHistoryTable: false },
                false
            ],
            [
                'absent when useHistoryTable is true',
                { resourceType: 'Patient', parsedArgItems: [], operation: OPERATIONS.READ, useHistoryTable: true },
                false
            ],
            [
                'absent for resourceType AuditEvent',
                { resourceType: 'AuditEvent', parsedArgItems: [], operation: OPERATIONS.READ, useHistoryTable: false },
                false
            ]
        ])('%s', (_name, { resourceType, parsedArgItems, operation, useHistoryTable }, expectPresent) => {
            const parsedArgs = new ParsedArgs({ base_version: '4_0_0', parsedArgItems });

            const { query } = creator.buildR4SearchQuery({
                resourceType,
                parsedArgs,
                useHistoryTable,
                operation,
                isUser: false
            });

            const hiddenTagClause = findHiddenTagClause(query);

            if (expectPresent) {
                expect(hiddenTagClause).toBeDefined();
                expect(hiddenTagClause.$not.$elemMatch).toEqual({
                    system: RESOURCE_HIDDEN_TAG.SYSTEM,
                    code: RESOURCE_HIDDEN_TAG.CODE
                });
            } else {
                expect(hiddenTagClause).toBeUndefined();
            }
        });

        test('_includeHidden=false does NOT suppress the filter - only a true-ish value does', () => {
            const parsedArgs = new ParsedArgs({
                base_version: '4_0_0',
                parsedArgItems: [includeHiddenParsedArgsItem('false')]
            });

            const { query } = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                useHistoryTable: false,
                operation: OPERATIONS.READ,
                isUser: false
            });

            expect(findHiddenTagClause(query)).toBeDefined();
        });

        test('each condition is independent: combining id lookup with an otherwise-default search still suppresses the filter even though operation/history/resourceType would normally trigger it', () => {
            // Sanity check that the five conditions are OR'd (any one suppresses), not AND'd.
            const parsedArgs = new ParsedArgs({
                base_version: '4_0_0',
                parsedArgItems: [idParsedArgsItem('abc123')]
            });

            const { query } = creator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs,
                useHistoryTable: false,
                operation: OPERATIONS.READ,
                isUser: false
            });

            expect(findHiddenTagClause(query)).toBeUndefined();
        });
    });

    describe('Connection-type tag - DataSharingManager (PROA/IAS consent-driven branch)', () => {
        const CONNECTION_TYPE_SYSTEM = 'https://www.icanbwell.com/connectionType';

        describe('ConfigManager.getConsentConnectionTypesList - the allow-list source', () => {
            const originalEnvValue = process.env.CONSENT_CONNECTION_TYPES_LIST;

            afterEach(() => {
                if (originalEnvValue === undefined) {
                    delete process.env.CONSENT_CONNECTION_TYPES_LIST;
                } else {
                    process.env.CONSENT_CONNECTION_TYPES_LIST = originalEnvValue;
                }
            });

            test('defaults to [\'proa\'] when CONSENT_CONNECTION_TYPES_LIST is unset', () => {
                delete process.env.CONSENT_CONNECTION_TYPES_LIST;
                const configManager = new ConfigManager();
                expect(configManager.getConsentConnectionTypesList).toEqual(['proa']);
            });

            test('splits a comma-separated CONSENT_CONNECTION_TYPES_LIST env var (e.g. adding IAS)', () => {
                process.env.CONSENT_CONNECTION_TYPES_LIST = 'proa,ias';
                const configManager = new ConfigManager();
                expect(configManager.getConsentConnectionTypesList).toEqual(['proa', 'ias']);
            });
        });

        describe('DataSharingManager.filterPatientsByConnectionType - allow-list filtering of patient ids', () => {
            /** @type {DataSharingManager} */
            let dataSharingManager;

            beforeEach(() => {
                dataSharingManager = createDataSharingManager();
            });

            test('keeps a patient whose connection type IS in the allow-list', () => {
                const allowedPatientIds = new Set(['patient-proa']);
                const patientIdToConnectionTypeMap = new Map([['patient-proa', 'proa']]);

                dataSharingManager.filterPatientsByConnectionType({
                    allowedPatientIds,
                    patientIdToConnectionTypeMap,
                    allowedConnectionTypesList: ['proa']
                });

                expect(allowedPatientIds.has('patient-proa')).toBe(true);
            });

            test('removes a patient whose connection type is NOT in the allow-list', () => {
                const allowedPatientIds = new Set(['patient-other']);
                const patientIdToConnectionTypeMap = new Map([['patient-other', 'some-other-connection-type']]);

                dataSharingManager.filterPatientsByConnectionType({
                    allowedPatientIds,
                    patientIdToConnectionTypeMap,
                    allowedConnectionTypesList: ['proa']
                });

                expect(allowedPatientIds.has('patient-other')).toBe(false);
                expect(allowedPatientIds.size).toBe(0);
            });

            test('removes a patient with no recorded connection type at all', () => {
                const allowedPatientIds = new Set(['patient-unknown']);
                const patientIdToConnectionTypeMap = new Map();

                dataSharingManager.filterPatientsByConnectionType({
                    allowedPatientIds,
                    patientIdToConnectionTypeMap,
                    allowedConnectionTypesList: ['proa']
                });

                expect(allowedPatientIds.has('patient-unknown')).toBe(false);
            });

            test('mixed set: keeps only the allow-listed connection type', () => {
                const allowedPatientIds = new Set(['patient-proa', 'patient-other']);
                const patientIdToConnectionTypeMap = new Map([
                    ['patient-proa', 'proa'],
                    ['patient-other', 'some-other-connection-type']
                ]);

                dataSharingManager.filterPatientsByConnectionType({
                    allowedPatientIds,
                    patientIdToConnectionTypeMap,
                    allowedConnectionTypesList: ['proa']
                });

                expect([...allowedPatientIds]).toEqual(['patient-proa']);
            });
        });

        describe('DataSharingManager.getConnectionTypeFilteredQuery - restricts the reconstructed query to allow-listed connection types', () => {
            const PATIENT_UUID = 'a1111111-1111-1111-1111-111111111111';

            /** @type {DataSharingManager} */
            let dataSharingManager;

            beforeEach(() => {
                const r4SearchQueryCreator = createR4SearchQueryCreator();
                const searchQueryBuilder = new SearchQueryBuilder({ r4SearchQueryCreator });
                dataSharingManager = createDataSharingManager({ searchQueryBuilder });
            });

            /**
             * A parsedArgs for Observation?subject=Patient/<uuid> - a patient-targeting reference
             * filter, which is exactly the shape getConnectionTypeFilteredQuery rewrites.
             */
            function buildSubjectReferenceParsedArgs () {
                const propertyObj = new SearchParameterDefinition({
                    type: 'reference',
                    field: 'subject',
                    target: ['Patient']
                });
                const parsedArgsItem = new ParsedArgsItem({
                    queryParameter: 'subject',
                    queryParameterValue: new QueryParameterValue({
                        value: `Patient/${PATIENT_UUID}`,
                        operator: '$and'
                    }),
                    propertyObj,
                    modifiers: []
                });
                return new ParsedArgs({ base_version: '4_0_0', parsedArgItems: [parsedArgsItem] });
            }

            test('ANDs a meta.security connectionType $in filter restricted to the allow-list onto the query', () => {
                const parsedArgs = buildSubjectReferenceParsedArgs();
                const allowedPatientIds = new Set([PATIENT_UUID]);

                const result = dataSharingManager.getConnectionTypeFilteredQuery({
                    base_version: '4_0_0',
                    resourceType: 'Observation',
                    allowedPatientIds,
                    parsedArgs,
                    allowedConnectionTypesList: ['proa'],
                    useHistoryTable: false,
                    patientsList: [],
                    isUser: false
                });

                expect(result).not.toBeNull();
                expect(result.$and).toBeDefined();

                const connectionTypeSegment = result.$and.find((seg) => seg && seg['meta.security']);
                expect(connectionTypeSegment).toBeDefined();
                expect(connectionTypeSegment['meta.security'].$elemMatch.system).toBe(CONNECTION_TYPE_SYSTEM);

                // The allow-listed connection type is queryable through this $in clause...
                expect(connectionTypeSegment['meta.security'].$elemMatch.code.$in).toContain('proa');
                // ...but a connection type that was never allow-listed is not: a resource tagged
                // only with it would not satisfy this $elemMatch.
                expect(connectionTypeSegment['meta.security'].$elemMatch.code.$in).not.toContain('some-other-connection-type');
            });

            test('reflects a wider allow-list (e.g. PROA + IAS) verbatim in the $in filter', () => {
                const parsedArgs = buildSubjectReferenceParsedArgs();
                const allowedPatientIds = new Set([PATIENT_UUID]);

                const result = dataSharingManager.getConnectionTypeFilteredQuery({
                    base_version: '4_0_0',
                    resourceType: 'Observation',
                    allowedPatientIds,
                    parsedArgs,
                    allowedConnectionTypesList: ['proa', 'ias'],
                    useHistoryTable: false,
                    patientsList: [],
                    isUser: false
                });

                const connectionTypeSegment = result.$and.find((seg) => seg && seg['meta.security']);
                expect(connectionTypeSegment['meta.security'].$elemMatch.code.$in).toEqual(['proa', 'ias']);
            });

            test('returns null when the only referenced patient was already excluded from allowedPatientIds (e.g. dropped upstream by filterPatientsByConnectionType)', () => {
                const parsedArgs = buildSubjectReferenceParsedArgs();
                // Simulates filterPatientsByConnectionType having removed this patient because its
                // connection type wasn't allow-listed: allowedPatientIds no longer contains it.
                const allowedPatientIds = new Set();

                const result = dataSharingManager.getConnectionTypeFilteredQuery({
                    base_version: '4_0_0',
                    resourceType: 'Observation',
                    allowedPatientIds,
                    parsedArgs,
                    allowedConnectionTypesList: ['proa'],
                    useHistoryTable: false,
                    patientsList: [],
                    isUser: false
                });

                expect(result).toBeNull();
            });
        });
    });
});
