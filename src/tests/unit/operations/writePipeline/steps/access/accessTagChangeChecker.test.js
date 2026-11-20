const { describe, test, expect, jest } = require('@jest/globals');
const { AccessTagChangeChecker } = require('../../../../../../operations/writePipeline/steps/access/accessTagChangeChecker');
const { ScopesValidator } = require('../../../../../../operations/security/scopesValidator');
const { ScopesManager } = require('../../../../../../operations/security/scopesManager');
const { ConfigManager } = require('../../../../../../utils/configManager');
const { PatientFilterManager } = require('../../../../../../fhir/patientFilterManager');
const { SecurityTagSystem } = require('../../../../../../utils/securityTagSystem');
const { WriteItem } = require('../../../../../../operations/writePipeline/writeItem');
const { WriteContext } = require('../../../../../../operations/writePipeline/writeContext');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../../../../../operations/writePipeline/writeFailure');

/**
 * The caller's request info: a synthetic user that holds the write access scope of one tenant.
 */
const REQUEST_INFO = Object.freeze({
    requestId: 'synthetic-request',
    user: 'synthetic-user',
    scope: 'user/*.* access/client.*'
});

/**
 * A `_uuid` for the items.
 */
const ITEM_UUID = '00000000-0000-4000-8000-00000000000a';

/**
 * Builds a context for the synthetic request.
 */
const buildContext = () => new WriteContext({
    requestInfo: REQUEST_INFO,
    base_version: '4_0_0',
    parsedArgs: {},
    smartMerge: false
});

/**
 * Builds a Patient that carries one access tag for each of the given codes.
 */
const buildPatient = (accessCodes) => ({
    resourceType: 'Patient',
    id: 'synthetic-patient',
    _uuid: ITEM_UUID,
    _sourceAssigningAuthority: 'client',
    meta: {
        security: accessCodes.map((code) => ({ system: SecurityTagSystem.access, code }))
    }
});

/**
 * Builds an item whose stored document and built document carry the given access codes. A `null`
 * for `candidateCodes` makes it a no-op item with no built document.
 */
const buildItem = ({ index = 0, storedCodes, candidateCodes }) => {
    const item = new WriteItem({ index, incoming: buildPatient(storedCodes) });
    item.stored = buildPatient(storedCodes);
    item.candidate = candidateCodes === null ? null : buildPatient(candidateCodes);
    return item;
};

/**
 * Builds the real scopes validator on a real scopes manager, so the access tag rules are the
 * production ones. The managers around them are never reached by the access tag check.
 */
const buildScopesValidator = () => {
    const scopesValidator = Object.create(ScopesValidator.prototype);
    scopesValidator.scopesManager = new ScopesManager({
        configManager: Object.create(ConfigManager.prototype),
        patientFilterManager: Object.create(PatientFilterManager.prototype)
    });
    return scopesValidator;
};

describe('AccessTagChangeChecker', () => {
    test('allows an unchanged tag set', async () => {
        const checker = new AccessTagChangeChecker({ scopesValidator: buildScopesValidator() });
        const items = [buildItem({ storedCodes: ['client'], candidateCodes: ['client'] })];

        const failures = await checker.checkAsync({ items, context: buildContext(), accessRequested: 'u' });

        expect(failures).toStrictEqual([null]);
    });

    test.each([
        {
            name: 'adds an access tag the caller cannot write',
            storedCodes: ['client'],
            candidateCodes: ['client', 'other-tenant']
        },
        {
            name: 'removes an access tag the caller cannot write',
            storedCodes: ['client', 'other-tenant'],
            candidateCodes: ['client']
        }
    ])('fails an item that $name', async ({ storedCodes, candidateCodes }) => {
        const checker = new AccessTagChangeChecker({ scopesValidator: buildScopesValidator() });
        const items = [buildItem({ storedCodes, candidateCodes })];

        const failures = await checker.checkAsync({ items, context: buildContext(), accessRequested: 'u' });

        const expectedText =
            'user synthetic-user can only add or remove access tags it has write access to, ' +
            'for resource Patient with id synthetic-patient';
        expect(failures).toHaveLength(1);
        expect(failures[0]).toBeInstanceOf(WriteFailure);
        expect(failures[0].stage).toBe(WRITE_FAILURE_STAGE.ACCESS);
        expect(failures[0].subject).toStrictEqual({
            id: 'synthetic-patient',
            uuid: ITEM_UUID,
            sourceAssigningAuthority: 'client',
            resourceType: 'Patient'
        });
        expect(failures[0].error).toBeNull();
        expect(failures[0].operationOutcome.issue[0].code).toBe('forbidden');
        expect(failures[0].operationOutcome.issue[0].details.text).toBe(expectedText);
    });

    test('skips an item whose candidate is null', async () => {
        const scopesValidator = buildScopesValidator();
        const checkSpy = jest.spyOn(scopesValidator, 'isAccessTagChangeAllowedByAccessScopes');
        const checker = new AccessTagChangeChecker({ scopesValidator });
        const items = [
            buildItem({ index: 0, storedCodes: ['client', 'other-tenant'], candidateCodes: null }),
            buildItem({ index: 1, storedCodes: ['client'], candidateCodes: ['client', 'other-tenant'] })
        ];

        const failures = await checker.checkAsync({ items, context: buildContext(), accessRequested: 'u' });

        expect(failures[0]).toBeNull();
        expect(failures[1]).toBeInstanceOf(WriteFailure);
        expect(checkSpy).toHaveBeenCalledTimes(1);
    });

    test.each(['u', 'c'])(
        'checks the stored and built documents of each item with the request info and accessRequested %s',
        async (accessRequested) => {
            const scopesValidator = buildScopesValidator();
            const checkSpy = jest.spyOn(scopesValidator, 'isAccessTagChangeAllowedByAccessScopes');
            const checker = new AccessTagChangeChecker({ scopesValidator });
            const items = [
                buildItem({ index: 0, storedCodes: ['client'], candidateCodes: ['client'] }),
                buildItem({ index: 1, storedCodes: ['client'], candidateCodes: ['client'] })
            ];

            await checker.checkAsync({ items, context: buildContext(), accessRequested });

            expect(checkSpy.mock.calls.map(([args]) => args)).toStrictEqual(
                items.map((item) => ({
                    requestInfo: REQUEST_INFO,
                    currentResource: item.stored,
                    updatedResource: item.candidate,
                    accessRequested
                }))
            );
        }
    );

    test('returns one entry per item, in item order', async () => {
        const checker = new AccessTagChangeChecker({ scopesValidator: buildScopesValidator() });
        const items = [
            buildItem({ index: 0, storedCodes: ['client'], candidateCodes: ['client'] }),
            buildItem({ index: 1, storedCodes: ['client'], candidateCodes: ['client', 'other-tenant'] }),
            buildItem({ index: 2, storedCodes: ['client'], candidateCodes: null })
        ];

        const failures = await checker.checkAsync({ items, context: buildContext(), accessRequested: 'u' });

        expect(failures.map((failure) => failure?.stage ?? null)).toStrictEqual([
            null,
            WRITE_FAILURE_STAGE.ACCESS,
            null
        ]);
    });

    test('lets a non-403 error through', async () => {
        const scopesValidator = buildScopesValidator();
        const error = new Error('synthetic failure');
        jest.spyOn(scopesValidator, 'isAccessTagChangeAllowedByAccessScopes').mockImplementation(() => {
            throw error;
        });
        const checker = new AccessTagChangeChecker({ scopesValidator });
        const items = [buildItem({ storedCodes: ['client'], candidateCodes: ['client'] })];

        await expect(
            checker.checkAsync({ items, context: buildContext(), accessRequested: 'u' })
        ).rejects.toBe(error);
    });
});
