/**
 * DCON-4894 Commit A: dry-run logging for Person.link traversal below a configured assurance
 * minimum.
 *
 * This is deliberately a LOGGING-ONLY change: when configManager.logPersonLinkAssuranceBelowMinimum
 * is true, a warning is logged for every Person.link followed whose `assurance` value does not
 * meet configManager.personLinkAssuranceMinimumLevel (including a missing/absent assurance,
 * which ranks 0 -- see personLinkAssuranceLevel.js). Traversal behavior itself (which
 * patients/persons get returned/recursed into) must be byte-for-byte identical regardless of the
 * flag -- this commit adds observability only, no enforcement.
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../operations/common/logging', () => ({
    logWarn: jestGlobal.fn(),
    logError: jestGlobal.fn(),
    logInfo: jestGlobal.fn(),
    logDebug: jestGlobal.fn()
}));

const { logWarn } = require('../../../operations/common/logging');
const { PersonToPatientIdsExpander } = require('../../../utils/personToPatientIdsExpander');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');

/**
 * Creates an object that satisfies `instanceof RealClass` (used by this module's
 * assertTypeEquals() constructor checks) without running the real constructor.
 */
function createStubInstance (RealClass, overrides = {}) {
    const instance = Object.create(RealClass.prototype);
    for (const [key, value] of Object.entries(overrides)) {
        Object.defineProperty(instance, key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true
        });
    }
    return instance;
}

function makeFakeCursor (docs) {
    let index = 0;
    return {
        hasNext: jestGlobal.fn(async () => index < docs.length),
        nextObject: jestGlobal.fn(async () => docs[index++])
    };
}

describe('PersonToPatientIdsExpander — DCON-4894 dry-run assurance logging (Commit A)', () => {
    const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
    const { ScopesManager } = require('../../../operations/security/scopesManager');
    const { SecurityTagManager } = require('../../../operations/common/securityTagManager');
    const { ConfigManager } = require('../../../utils/configManager');

    const topPerson = {
        id: 'person-top',
        _uuid: 'person-top-uuid',
        _sourceId: 'person-top',
        meta: { security: [{ system: SecurityTagSystem.access, code: 'clientA' }] },
        link: [
            // Below the level2 minimum -- should be logged.
            { target: { _uuid: 'Patient/patient-weak-link-uuid', type: 'Patient' }, assurance: 'level1' },
            // No assurance at all -- ranks 0, also below the minimum -- should be logged.
            { target: { _uuid: 'Patient/patient-no-assurance-uuid', type: 'Patient' } },
            // At/above the minimum -- should NOT be logged.
            { target: { _uuid: 'Patient/patient-strong-link-uuid', type: 'Patient' }, assurance: 'level4' }
        ]
    };

    function createExpander (configOverrides) {
        const scopesManager = createStubInstance(ScopesManager, {});
        const securityTagManager = createStubInstance(SecurityTagManager, {});
        const configManager = createStubInstance(ConfigManager, {
            useAccessIndex: false,
            enableProxyPersonScopeCheckForEverything: false,
            personLinkAssuranceMinimumLevel: 'level2',
            logPersonLinkAssuranceBelowMinimum: false,
            ...configOverrides
        });
        const databaseQueryFactory = createStubInstance(DatabaseQueryFactory);

        return new PersonToPatientIdsExpander({
            databaseQueryFactory,
            scopesManager,
            securityTagManager,
            configManager
        });
    }

    async function runExpansion (expander) {
        const mockDatabaseQueryManager = {
            findAsync: jestGlobal.fn(async () => makeFakeCursor([topPerson]))
        };
        return expander.getPatientIdsFromPersonAsync({
            personIds: ['person-top'],
            totalProcessedPersonIds: new Set(),
            databaseQueryManager: mockDatabaseQueryManager,
            level: 1,
            toMap: false
        });
    }

    beforeEach(() => {
        logWarn.mockClear();
    });

    test('logs a warning for each below-minimum link when the flag is on, and identifies person/target/assurance/minimum', async () => {
        const expander = createExpander({ logPersonLinkAssuranceBelowMinimum: true });

        await runExpansion(expander);

        // Exactly the two below-minimum links should have triggered a warning.
        expect(logWarn).toHaveBeenCalledTimes(2);

        const loggedContexts = logWarn.mock.calls.map((call) => call[1]);

        expect(loggedContexts).toContainEqual(
            expect.objectContaining({
                personId: 'person-top-uuid',
                targetId: 'patient-weak-link-uuid',
                assurance: 'level1',
                minimumLevel: 'level2'
            })
        );
        expect(loggedContexts).toContainEqual(
            expect.objectContaining({
                personId: 'person-top-uuid',
                targetId: 'patient-no-assurance-uuid',
                assurance: undefined,
                minimumLevel: 'level2'
            })
        );

        // The at/above-minimum link must NOT have been logged.
        expect(loggedContexts.some((ctx) => ctx.targetId === 'patient-strong-link-uuid')).toBe(false);
    });

    test('does not log anything when the flag is off (default)', async () => {
        const expander = createExpander({ logPersonLinkAssuranceBelowMinimum: false });

        await runExpansion(expander);

        expect(logWarn).not.toHaveBeenCalled();
    });

    test('traversal result is byte-for-byte identical whether the logging flag is on or off', async () => {
        const expanderWithLogging = createExpander({ logPersonLinkAssuranceBelowMinimum: true });
        const resultWithLogging = await runExpansion(expanderWithLogging);

        const expanderWithoutLogging = createExpander({ logPersonLinkAssuranceBelowMinimum: false });
        const resultWithoutLogging = await runExpansion(expanderWithoutLogging);

        expect(resultWithLogging).toEqual(resultWithoutLogging);
        // Sanity: all three links are still followed either way -- Commit A must not enforce.
        expect(resultWithLogging).toContain('patient-weak-link-uuid');
        expect(resultWithLogging).toContain('patient-no-assurance-uuid');
        expect(resultWithLogging).toContain('patient-strong-link-uuid');
    });

    test('does not log a below-minimum warning for a link whose target is not a Patient/Person (never followed either way)', async () => {
        const personWithNonFollowableLink = {
            id: 'person-top-2',
            _uuid: 'person-top-2-uuid',
            _sourceId: 'person-top-2',
            meta: { security: [{ system: SecurityTagSystem.access, code: 'clientA' }] },
            link: [
                // Legal per FHIR R4 (Person.link.target is Patient|Practitioner|RelatedPerson|Person)
                // but never followed by patientIdsToAdd/personResourceWithPersonReferenceLink below --
                // must not be treated as a below-minimum "link followed" warning even though its
                // assurance (missing) ranks 0.
                { target: { _uuid: 'Practitioner/practitioner-1', type: 'Practitioner' } }
            ]
        };
        const expander = createExpander({ logPersonLinkAssuranceBelowMinimum: true });
        const mockDatabaseQueryManager = {
            findAsync: jestGlobal.fn(async () => makeFakeCursor([personWithNonFollowableLink]))
        };

        const result = await expander.getPatientIdsFromPersonAsync({
            personIds: ['person-top-2'],
            totalProcessedPersonIds: new Set(),
            databaseQueryManager: mockDatabaseQueryManager,
            level: 1,
            toMap: false
        });

        expect(logWarn).not.toHaveBeenCalled();
        // Only the top person's own proxy-person id is returned -- the Practitioner-target link
        // never contributes a patient/person id either way, with or without this fix.
        expect(result).toEqual(['person.person-top-2-uuid']);
    });

    test('falls back to the default minimum (and warns about it) when the configured minimum is not a recognized level', async () => {
        // 'level0' is not a recognized identity-assuranceLevel code. Without a fallback, ranking
        // it would return 0, making meetsMinimumAssurance true for every link (including the
        // no-assurance one) -- silently disabling the below-minimum warning entirely. Confirm
        // instead that: (a) a warning about the bad config is logged, and (b) the below-minimum
        // links are still identified using the real default ('level2'), not silently let through.
        const expander = createExpander({
            logPersonLinkAssuranceBelowMinimum: true,
            personLinkAssuranceMinimumLevel: 'level0'
        });

        await runExpansion(expander);

        const loggedContexts = logWarn.mock.calls.map((call) => call[1]);
        const loggedMessages = logWarn.mock.calls.map((call) => call[0]);

        expect(loggedMessages).toContainEqual(expect.stringContaining('not a recognized'));
        // The two below-'level2' links are still flagged despite the bad configured value.
        expect(loggedContexts).toContainEqual(
            expect.objectContaining({ targetId: 'patient-weak-link-uuid', minimumLevel: 'level2' })
        );
        expect(loggedContexts).toContainEqual(
            expect.objectContaining({ targetId: 'patient-no-assurance-uuid', minimumLevel: 'level2' })
        );
    });
});
