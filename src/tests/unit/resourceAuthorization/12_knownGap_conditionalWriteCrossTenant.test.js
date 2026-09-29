'use strict';

/**
 * Regression test for a suspected §12 finding that turned out NOT to reproduce against the real
 * implementation: "conditional update/delete can match a cross-tenant resource via a shared
 * clinical identifier."
 *
 * The theory (from src/tests/unit/operations/update/conditionalCrossTenant.test.js, a pre-existing
 * CI-excluded test file): since the patient-scope branch of query construction restricts by the
 * caller's own patient-id set rather than by owner/access tag (see docs/resource-authorization.md
 * §5 -- true, and by design), a conditional write like `PUT /Patient?identifier=SSN|123-45-6789`
 * might match a *different* tenant's Patient sharing that identifier, since the identifier search
 * clause alone carries no tenant restriction.
 *
 * That theory does not hold up: `PatientQueryCreator.getQueryWithPatientFilter` ANDs the
 * patient-id restriction onto whatever query it's given via
 * `R4SearchQueryCreator.appendAndSimplifyQuery` -- it does not replace the identifier clause, it
 * combines with it. A resource matching the identifier but whose `_uuid` isn't in the caller's own
 * resolved patient-id set can never satisfy the resulting `$and`. This test proves that
 * composition against the REAL (non-mocked) `PatientQueryCreator` and `PatientFilterManager`, with
 * only the Mongo query-execution layer simulated.
 *
 * (The two tests in conditionalCrossTenant.test.js that originally asserted the incorrect premise
 * mocked `searchManager` entirely and asserted against their own fabricated mock return value --
 * see that file's updated header comment. They've been corrected; this file is the real proof.)
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logWarn: jest.fn()
}));

const { PatientFilterManager } = require('../../../fhir/patientFilterManager');
const { PatientQueryCreator } = require('../../../operations/common/patientQueryCreator');
const { R4SearchQueryCreator } = require('../../../operations/query/r4');
const { R4ArgsParser } = require('../../../operations/query/r4ArgsParser');
const { ConfigManager } = require('../../../utils/configManager');
const { AccessIndexManager } = require('../../../operations/common/accessIndexManager');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

describe('§12 investigated finding — conditional write cross-tenant match via shared identifier ' +
    '(NOT reproducible: patient-id filter ANDs with the search query, not OR/replaces it)', () => {
    /** @type {PatientQueryCreator} */
    let patientQueryCreator;

    beforeEach(() => {
        const realPatientFilterManager = new PatientFilterManager();

        // Only appendAndSimplifyQuery is exercised for resourceType: 'Patient' (the `id` ->
        // `_uuid` self-reference branch never touches buildR4SearchQuery/r4ArgsParser), so those
        // collaborators can be lightweight stand-ins -- appendAndSimplifyQuery itself is the real
        // R4SearchQueryCreator method, not mocked, since it's the exact mechanism under test.
        const realR4SearchQueryCreator = new R4SearchQueryCreator({
            configManager: createMockInstance(ConfigManager),
            accessIndexManager: createMockInstance(AccessIndexManager),
            r4ArgsParser: createMockInstance(R4ArgsParser)
        });

        patientQueryCreator = new PatientQueryCreator({
            patientFilterManager: realPatientFilterManager,
            r4SearchQueryCreator: realR4SearchQueryCreator,
            r4ArgsParser: createMockInstance(R4ArgsParser)
        });
    });

    test('a conditional Patient search by identifier is ANDed with the caller\'s own patient-id ' +
        'restriction, not replaced by it', () => {
        // Base query as if built from `?identifier=http://hl7.org/fhir/sid/us-ssn|123-45-6789` --
        // this alone would match ANY tenant's Patient sharing that SSN, including tenant_a's.
        const identifierSearchQuery = { $and: [{ 'identifier.value': '123-45-6789' }] };

        // The caller (tenant_b) has resolved exactly one patient id from their own identity graph
        // -- a real UUID format, so this exercises the _uuid branch (as a real resolved patient id
        // would) -- NOT tenant_a's patient uuid, even though that patient happens to share the SSN.
        const callersOwnPatientUuid = '11111111-1111-1111-1111-111111111111';
        const tenantAPatientUuid = '22222222-2222-2222-2222-222222222222';

        const finalQuery = patientQueryCreator.getQueryWithPatientFilter({
            patientIds: [callersOwnPatientUuid],
            query: identifierSearchQuery,
            resourceType: 'Patient',
            useHistoryTable: false,
            personIds: null
        });

        // The resolved query must require BOTH the identifier match AND the caller's own patient
        // uuid -- i.e. an $and, not a bare identifier filter and not an $or. (MongoQuerySimplifier
        // collapses a single-element $in down to a bare equality, hence no {$in: [...]} here.)
        expect(finalQuery.$and).toBeDefined();
        expect(finalQuery.$and).toContainEqual({ 'identifier.value': '123-45-6789' });
        expect(finalQuery.$and).toContainEqual({ _uuid: callersOwnPatientUuid });

        // Simulate evaluating this Mongo query against tenant_a's patient (identifier matches,
        // uuid does not) and against the caller's own patient (both match) to make the AND
        // semantics unambiguous rather than just inspecting query shape. Neither test document
        // carries a confidentiality-restriction tag, so the extra `$not $elemMatch` clause the
        // real query also carries (docs/resource-authorization.md §9) is satisfied by both and
        // isn't the discriminating factor being tested here.
        function matchesQuery (doc, query) {
            const clauses = query.$and || [query];
            return clauses.every((clause) => {
                return Object.entries(clause).every(([field, condition]) => {
                    if (condition && typeof condition === 'object' && '$not' in condition) {
                        return true; // neither test doc has meta.security at all
                    }
                    if (condition && typeof condition === 'object' && '$in' in condition) {
                        return condition.$in.includes(doc[field]);
                    }
                    return doc[field] === condition;
                });
            });
        }

        const tenantAPatientSharingIdentifier = {
            'identifier.value': '123-45-6789',
            _uuid: tenantAPatientUuid
        };
        const callersOwnPatient = {
            'identifier.value': '123-45-6789',
            _uuid: callersOwnPatientUuid
        };

        expect(matchesQuery(tenantAPatientSharingIdentifier, finalQuery)).toBe(false);
        expect(matchesQuery(callersOwnPatient, finalQuery)).toBe(true);
    });

    test('an empty patient-id set (caller with no resolved patients yet) fails closed, not open', () => {
        // review.md §D: an authorization-derived filter that ends up matching nothing must
        // produce "return nothing," never "no filter, so return everything."
        const identifierSearchQuery = { $and: [{ 'identifier.value': '999-99-9999' }] };

        const finalQuery = patientQueryCreator.getQueryWithPatientFilter({
            patientIds: [],
            query: identifierSearchQuery,
            resourceType: 'Patient',
            useHistoryTable: false,
            personIds: null
        });

        expect(finalQuery).toEqual({ _uuid: '__invalid__' });
    });
});
