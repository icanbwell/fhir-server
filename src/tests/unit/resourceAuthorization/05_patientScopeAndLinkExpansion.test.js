'use strict';

/**
 * Regression tests for docs/resource-authorization.md §5 "Patient-scoped tokens, proxy-patient,
 * and Person/Patient link expansion".
 *
 * Verifies, against the REAL implementations (never a stand-in/fabricated class):
 *   - ScopesManager.isAccessAllowedByPatientScopes: the gate that routes a caller into the
 *     patient-scope access-check branch at all. It requires BOTH a `patient/` scope AND a
 *     patient-filterable resource type; when either is missing, the caller falls through to the
 *     (separate, mutually exclusive) access-tag branch instead.
 *   - PersonToPatientIdsExpander.getPatientIdsFromPersonAsync: walks Person.link to resolve every
 *     linked Patient id (plus the proxy-patient id for each Person visited), and the
 *     maximumRecursionDepth = 4 safety cap on that walk -- hitting the cap logs a warning and
 *     returns whatever was resolved so far rather than erroring.
 *   - PatientScopeManager.getPatientIdsFromScopeAsync: composes the proxy-patient id
 *     (person.<uuid>) with the linked Patient ids resolved via the REAL
 *     PersonToPatientIdsExpander (only the Mongo query layer underneath it is mocked).
 *   - PatientQueryCreator.getQueryWithPatientFilter: turns a resolved id set into the actual Mongo
 *     restriction, using the real per-resource-type reference path in patientFilterManager.js
 *     (patientFilterMapping).
 *
 * NOT duplicated here:
 *   - PatientProxyQueryRewriter.rewriteArgsAsync (the `?subject=Patient/person.<id>` proxy-patient
 *     search-parameter expansion) already has thorough, currently-running, real-class coverage in
 *     src/tests/unit/queryRewriters/patientProxyQueryRewriter.test.js.
 *   - The Person $everything result-narrowing comment in everythingHelper.js
 *     (retriveveRelatedResourcesParallelyAsync, "restrict the returned Person resources to only
 *     the ids explicitly requested") is not unit tested here: it is embedded deep inside a single
 *     ~400 line method that also needs a fully wired EverythingHelper (SearchManager,
 *     ScopesValidator, SearchParametersManager, parseQueryStringIntoArgs, MongoQuerySimplifier,
 *     etc.) plus a fabricated relatedResources/parentResourceIdentifiers fixture just to reach the
 *     four lines in question. Isolating it as a real-class unit test would mean re-implementing
 *     most of $everything's plumbing as mocks -- exactly the kind of brittle, low-signal test this
 *     suite is trying to avoid. It is better covered at the $everything integration-test level.
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logWarn: jest.fn()
}));

const { ScopesManager } = require('../../../operations/security/scopesManager');
const { PatientFilterManager } = require('../../../fhir/patientFilterManager');
const { ConfigManager } = require('../../../utils/configManager');
const { PersonToPatientIdsExpander } = require('../../../utils/personToPatientIdsExpander');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { SecurityTagManager } = require('../../../operations/common/securityTagManager');
const { PatientScopeManager } = require('../../../operations/security/patientScopeManager');
const { PatientQueryCreator } = require('../../../operations/common/patientQueryCreator');
const { R4SearchQueryCreator } = require('../../../operations/query/r4');
const { R4ArgsParser } = require('../../../operations/query/r4ArgsParser');
const { PERSON_PROXY_PREFIX, RESOURCE_RESTRICTION_TAG } = require('../../../constants');
const { logWarn } = require('../../../operations/common/logging');

/**
 * Builds a plain object whose prototype chain satisfies `instanceof ClassType` (and therefore
 * assertTypeEquals) without pulling in the real class's own constructor/dependencies. Used only
 * for true external collaborators that are not exercised by the scenario under test.
 * @param {Function} ClassType
 */
function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

/**
 * Minimal async Mongo-cursor stand-in matching the {hasNext, nextObject} shape that
 * PersonToPatientIdsExpander reads from DatabaseQueryManager.findAsync().
 * @param {Object[]} docs
 */
function createCursor (docs) {
    let i = 0;
    return {
        hasNext: jest.fn(async () => i < docs.length),
        nextObject: jest.fn(async () => docs[i++])
    };
}

describe('Resource Authorization §5 — Patient scope, proxy-patient, Person/Patient link expansion', () => {
    describe('ScopesManager.isAccessAllowedByPatientScopes — gate for the patient-scope branch', () => {
        /** @type {ScopesManager} */
        let scopesManager;

        beforeEach(() => {
            scopesManager = new ScopesManager({
                configManager: createMockInstance(ConfigManager),
                // real PatientFilterManager so the "patient-filterable resourceType" half of the
                // gate is checked against the real mapping table, not a stub.
                patientFilterManager: new PatientFilterManager()
            });
        });

        test('true when caller has a patient/ scope AND resourceType is patient-filterable', () => {
            expect(scopesManager.isAccessAllowedByPatientScopes({
                scope: 'patient/Observation.read',
                resourceType: 'Observation'
            })).toBe(true);
        });

        test('false when caller has a patient/ scope but resourceType is NOT patient-filterable', () => {
            // StructureDefinition is not present in patientFilterMapping, personFilterMapping, or
            // either *WithQueryMapping table, so canAccessResourceWithPatientScope is false and
            // the patient-scope branch must not apply regardless of the scope held.
            expect(scopesManager.isAccessAllowedByPatientScopes({
                scope: 'patient/StructureDefinition.read',
                resourceType: 'StructureDefinition'
            })).toBe(false);
        });

        test('false when resourceType is patient-filterable but the scope has no patient/ entry (falls through to the access-tag branch)', () => {
            expect(scopesManager.isAccessAllowedByPatientScopes({
                scope: 'user/Observation.read access/tenant-a.read',
                resourceType: 'Observation'
            })).toBe(false);
        });

        test('true if ANY scope in a multi-scope string is a patient/ scope, even mixed with user/', () => {
            expect(scopesManager.isAccessAllowedByPatientScopes({
                scope: 'user/Patient.read patient/Observation.read',
                resourceType: 'Observation'
            })).toBe(true);
        });
    });

    describe('PersonToPatientIdsExpander.getPatientIdsFromPersonAsync — Person.link traversal', () => {
        /** @type {PersonToPatientIdsExpander} */
        let expander;
        let mockDatabaseQueryManager;

        beforeEach(() => {
            logWarn.mockClear();
            expander = new PersonToPatientIdsExpander({
                databaseQueryFactory: createMockInstance(DatabaseQueryFactory),
                scopesManager: createMockInstance(ScopesManager),
                securityTagManager: createMockInstance(SecurityTagManager),
                configManager: createMockInstance(ConfigManager)
            });
            mockDatabaseQueryManager = { findAsync: jest.fn() };
        });

        test('resolves the proxy-patient id plus the directly linked Patient id', async () => {
            const personX = {
                _uuid: 'person-X',
                link: [
                    { target: { _uuid: 'Patient/patient-X', type: 'Patient' } }
                ]
            };
            mockDatabaseQueryManager.findAsync.mockResolvedValueOnce(createCursor([personX]));

            const result = await expander.getPatientIdsFromPersonAsync({
                personIds: ['person-X'],
                totalProcessedPersonIds: new Set(),
                databaseQueryManager: mockDatabaseQueryManager,
                level: 1
            });

            expect(result).toEqual(['person.person-X', 'patient-X']);
            expect(logWarn).not.toHaveBeenCalled();
        });

        test('caps traversal at maximumRecursionDepth = 4: a Person.link chain 5 levels deep is only followed 4 levels, logs a warning, and does not throw', async () => {
            // Chain: A -> B -> C -> D -> E (5 links). The cap (4) is hit while processing D (the
            // 4th person resolved), so D's own outgoing link to E is discovered but E is never
            // queried/followed.
            const personA = {
                _uuid: 'A',
                link: [
                    { target: { _uuid: 'Patient/PA', type: 'Patient' } },
                    { target: { _uuid: 'Person/B', type: 'Person' } }
                ]
            };
            const personB = {
                _uuid: 'B',
                link: [
                    { target: { _uuid: 'Patient/PB', type: 'Patient' } },
                    { target: { _uuid: 'Person/C', type: 'Person' } }
                ]
            };
            const personC = {
                _uuid: 'C',
                link: [
                    { target: { _uuid: 'Patient/PC', type: 'Patient' } },
                    { target: { _uuid: 'Person/D', type: 'Person' } }
                ]
            };
            const personD = {
                _uuid: 'D',
                link: [
                    { target: { _uuid: 'Patient/PD', type: 'Patient' } },
                    { target: { _uuid: 'Person/E', type: 'Person' } }
                ]
            };

            mockDatabaseQueryManager.findAsync
                .mockResolvedValueOnce(createCursor([personA]))
                .mockResolvedValueOnce(createCursor([personB]))
                .mockResolvedValueOnce(createCursor([personC]))
                .mockResolvedValueOnce(createCursor([personD]));

            const result = await expander.getPatientIdsFromPersonAsync({
                personIds: ['A'],
                totalProcessedPersonIds: new Set(),
                databaseQueryManager: mockDatabaseQueryManager,
                level: 1
            });

            // Only 4 findAsync calls happen -- Person E (which would be level 5) is never queried.
            expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledTimes(4);

            // Levels 1-4 (A, B, C, D) are all resolved: proxy-patient id + direct Patient link.
            ['A', 'B', 'C', 'D'].forEach((id) => expect(result).toContain(`person.${id}`));
            ['PA', 'PB', 'PC', 'PD'].forEach((id) => expect(result).toContain(id));

            // Person E and its Patient (beyond the cap) are never resolved.
            expect(result).not.toContain('person.E');
            expect(result).not.toContain('PE');

            // Hitting the cap logs a warning instead of throwing -- this is a real, intentional
            // safety limit, not a bug.
            expect(logWarn).toHaveBeenCalledTimes(1);
            expect(logWarn).toHaveBeenCalledWith(
                expect.stringContaining('Maximum recursion depth of 4'),
                expect.any(Object)
            );
        });

        test('a Person with no Patient or Person links resolves to just its own proxy-patient id', async () => {
            const lonelyPerson = { _uuid: 'lonely', link: [] };
            mockDatabaseQueryManager.findAsync.mockResolvedValueOnce(createCursor([lonelyPerson]));

            const result = await expander.getPatientIdsFromPersonAsync({
                personIds: ['lonely'],
                totalProcessedPersonIds: new Set(),
                databaseQueryManager: mockDatabaseQueryManager,
                level: 1
            });

            expect(result).toEqual(['person.lonely']);
        });
    });

    describe('PatientScopeManager.getPatientIdsFromScopeAsync — proxy id + real link-expansion composition', () => {
        /** @type {PatientScopeManager} */
        let patientScopeManager;
        let mockDatabaseQueryManager;

        beforeEach(() => {
            mockDatabaseQueryManager = { findAsync: jest.fn() };
            const mockDatabaseQueryFactory = createMockInstance(DatabaseQueryFactory);
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue(mockDatabaseQueryManager);

            // The REAL PersonToPatientIdsExpander is wired in here -- only the Mongo query layer
            // underneath it (databaseQueryManager.findAsync) is mocked. This proves the doc's
            // claim that PatientScopeManager resolves ids via the real expander, not a stand-in.
            const realExpander = new PersonToPatientIdsExpander({
                databaseQueryFactory: mockDatabaseQueryFactory,
                scopesManager: createMockInstance(ScopesManager),
                securityTagManager: createMockInstance(SecurityTagManager),
                configManager: createMockInstance(ConfigManager)
            });

            patientScopeManager = new PatientScopeManager({
                databaseQueryFactory: mockDatabaseQueryFactory,
                personToPatientIdsExpander: realExpander,
                scopesManager: createMockInstance(ScopesManager),
                patientFilterManager: new PatientFilterManager()
            });
        });

        test('resolves the proxy-patient id (person.<uuid>) plus every Patient linked via Person.link', async () => {
            const personA = {
                _uuid: 'person-A',
                link: [
                    { target: { _uuid: 'Patient/patient-A1', type: 'Patient' } },
                    { target: { _uuid: 'Patient/patient-A2', type: 'Patient' } }
                ]
            };
            mockDatabaseQueryManager.findAsync.mockResolvedValueOnce(createCursor([personA]));

            const result = await patientScopeManager.getPatientIdsFromScopeAsync({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: 'person-A'
            });

            expect(result).toContain(`${PERSON_PROXY_PREFIX}person-A`);
            expect(result).toContain('patient-A1');
            expect(result).toContain('patient-A2');
        });

        test('returns just the proxy-patient id (no error) when the Person has no Patient links', async () => {
            const personLonely = { _uuid: 'person-lonely', link: [] };
            mockDatabaseQueryManager.findAsync.mockResolvedValueOnce(createCursor([personLonely]));

            const result = await patientScopeManager.getPatientIdsFromScopeAsync({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: 'person-lonely'
            });

            expect(result).toContain(`${PERSON_PROXY_PREFIX}person-lonely`);
        });

        test('returns an empty array when there is no personIdFromJwtToken (nothing to resolve)', async () => {
            const result = await patientScopeManager.getPatientIdsFromScopeAsync({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: null
            });
            expect(result).toEqual([]);
            expect(mockDatabaseQueryManager.findAsync).not.toHaveBeenCalled();
        });
    });

    describe('PatientQueryCreator.getQueryWithPatientFilter — resolved ids -> Mongo restriction', () => {
        /** @type {PatientQueryCreator} */
        let patientQueryCreator;

        beforeEach(() => {
            // Real PatientFilterManager: the doc's claim under test is specifically that this
            // class uses the real per-resource-type patientFilterMapping table.
            const realPatientFilterManager = new PatientFilterManager();

            const mockR4SearchQueryCreator = createMockInstance(R4SearchQueryCreator);
            // Only appendAndSimplifyQuery is exercised by the (simple-property) scenarios below;
            // buildR4SearchQuery is only used by the patientFilterWithQueryMapping (e.g.
            // Subscription) branch, which none of these tests hit.
            mockR4SearchQueryCreator.appendAndSimplifyQuery = jest.fn(({ query, andQuery }) => {
                if (query.$and) {
                    query.$and.push(andQuery);
                    return query;
                }
                if (Object.keys(query).length === 0) {
                    return andQuery;
                }
                return { $and: [query, andQuery] };
            });

            patientQueryCreator = new PatientQueryCreator({
                patientFilterManager: realPatientFilterManager,
                r4SearchQueryCreator: mockR4SearchQueryCreator,
                r4ArgsParser: createMockInstance(R4ArgsParser)
            });
        });

        test('throws ForbiddenError for a resource type not covered by the patient filter mapping', () => {
            expect(() => patientQueryCreator.getQueryWithPatientFilter({
                patientIds: ['patient-1'],
                query: {},
                resourceType: 'StructureDefinition',
                useHistoryTable: false,
                personIds: null
            })).toThrow(/cannot be accessed via a patient scope/);
        });

        test('Observation (patientFilterMapping: subject.reference): a uuid patient id filters on subject._uuid against Patient/<uuid>', () => {
            const query = patientQueryCreator.getQueryWithPatientFilter({
                patientIds: ['11111111-1111-1111-1111-111111111111'],
                query: {},
                resourceType: 'Observation',
                useHistoryTable: false,
                personIds: null
            });

            const flattened = JSON.stringify(query);
            expect(flattened).toContain('subject._uuid');
            expect(flattened).toContain('Patient/11111111-1111-1111-1111-111111111111');
        });

        test('Patient resourceType (patientFilterMapping: id): filters directly on _uuid, without a Patient/ reference prefix', () => {
            const query = patientQueryCreator.getQueryWithPatientFilter({
                patientIds: ['11111111-1111-1111-1111-111111111111'],
                query: {},
                resourceType: 'Patient',
                useHistoryTable: false,
                personIds: null
            });

            const flattened = JSON.stringify(query);
            expect(flattened).toContain('"_uuid"');
            expect(flattened).not.toContain('Patient/11111111');
        });

        test('a non-uuid (sourceId) patient id filters on subject._sourceId instead of subject._uuid', () => {
            const query = patientQueryCreator.getQueryWithPatientFilter({
                patientIds: ['source-id-not-a-uuid'],
                query: {},
                resourceType: 'Observation',
                useHistoryTable: false,
                personIds: null
            });

            const flattened = JSON.stringify(query);
            expect(flattened).toContain('subject._sourceId');
            expect(flattened).toContain('Patient/source-id-not-a-uuid');
        });

        test('returns an always-false query when neither patientIds nor personIds resolve to anything', () => {
            const query = patientQueryCreator.getQueryWithPatientFilter({
                patientIds: [],
                query: {},
                resourceType: 'Observation',
                useHistoryTable: false,
                personIds: null
            });
            expect(query).toEqual({ _uuid: '__invalid__' });
        });

        test('applies the common restricted-security (meta.security "R") exclusion filter on every successful query', () => {
            const query = patientQueryCreator.getQueryWithPatientFilter({
                patientIds: ['11111111-1111-1111-1111-111111111111'],
                query: {},
                resourceType: 'Observation',
                useHistoryTable: false,
                personIds: null
            });

            expect(query.$and).toBeDefined();
            const flattened = JSON.stringify(query);
            expect(flattened).toContain(RESOURCE_RESTRICTION_TAG.SYSTEM);
            expect(flattened).toContain(RESOURCE_RESTRICTION_TAG.CODE);
        });
    });
});
