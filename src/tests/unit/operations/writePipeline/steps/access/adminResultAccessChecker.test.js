const { describe, test, expect, jest } = require('@jest/globals');
const { AdminResultAccessChecker } = require('../../../../../../operations/writePipeline/steps/access/adminResultAccessChecker');
const { AccessTagChangeChecker } = require('../../../../../../operations/writePipeline/steps/access/accessTagChangeChecker');
const { ScopesValidator } = require('../../../../../../operations/security/scopesValidator');
const { ScopesManager } = require('../../../../../../operations/security/scopesManager');
const { PatientScopeManager } = require('../../../../../../operations/security/patientScopeManager');
const { PreSaveManager } = require('../../../../../../preSaveHandlers/preSave');
const { ConfigManager } = require('../../../../../../utils/configManager');
const { PatientFilterManager } = require('../../../../../../fhir/patientFilterManager');
const { SecurityTagSystem } = require('../../../../../../utils/securityTagSystem');
const { WriteItem } = require('../../../../../../operations/writePipeline/writeItem');
const { WriteContext } = require('../../../../../../operations/writePipeline/writeContext');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../../../../../operations/writePipeline/writeFailure');

/**
 * The caller's request info: a synthetic user that holds every access to the `client` tenant and
 * only read access to the `reader` tenant.
 */
const REQUEST_INFO = Object.freeze({
    requestId: 'synthetic-request',
    user: 'synthetic-user',
    scope: 'user/*.* access/client.* access/reader.read',
    isUser: false
});

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
 * Builds a Person owned by the first of `accessCodes` and carrying one access tag for each of them.
 */
const buildPerson = ({ index, accessCodes }) => ({
    resourceType: 'Person',
    id: `synthetic-person-${index}`,
    _uuid: `00000000-0000-4000-8000-0000000000a${index}`,
    _sourceAssigningAuthority: accessCodes[0],
    meta: {
        security: [
            { system: SecurityTagSystem.owner, code: accessCodes[0] },
            ...accessCodes.map((code) => ({ system: SecurityTagSystem.access, code }))
        ]
    }
});

/**
 * Builds an admin item. A `null` `storedCodes` makes it a created Person with no stored document;
 * a `null` `candidateCodes` makes it a no-op item with no built document.
 */
const buildItem = ({ index = 0, storedCodes, candidateCodes }) => {
    const item = new WriteItem({
        index,
        incoming: { resourceType: 'Person', id: `00000000-0000-4000-8000-0000000000a${index}` }
    });
    item.stored = storedCodes === null ? null : buildPerson({ index, accessCodes: storedCodes });
    item.candidate = candidateCodes === null ? null : buildPerson({ index, accessCodes: candidateCodes });
    return item;
};

/**
 * Builds the real scopes validator on a real scopes manager, so the access scope and access tag
 * rules are the production ones. The patient scope manager is the one boundary that reaches the
 * database, so it is faked to allow every write.
 */
const buildScopesValidator = () => {
    const patientScopeManager = Object.create(PatientScopeManager.prototype);
    patientScopeManager.canWriteResourceAsync = async () => true;
    const scopesValidator = Object.create(ScopesValidator.prototype);
    scopesValidator.scopesManager = new ScopesManager({
        configManager: Object.create(ConfigManager.prototype),
        patientFilterManager: new PatientFilterManager()
    });
    scopesValidator.patientScopeManager = patientScopeManager;
    scopesValidator.preSaveManager = new PreSaveManager({ preSaveHandlers: [] });
    return scopesValidator;
};

/**
 * Builds the checker on the real access-tag change checker and scopes validator, with spies on the
 * access-tag change checker and the validator's two checks, so a test can see what each received.
 */
const buildChecker = () => {
    const scopesValidator = buildScopesValidator();
    const accessTagChangeChecker = new AccessTagChangeChecker({ scopesValidator });
    const tagCheckerSpy = jest.spyOn(accessTagChangeChecker, 'checkAsync');
    const accessCheckSpy = jest.spyOn(scopesValidator, 'isAccessToResourceAllowedByAccessAndPatientScopes');
    const tagChangeSpy = jest.spyOn(scopesValidator, 'isAccessTagChangeAllowedByAccessScopes');
    const checker = new AdminResultAccessChecker({ scopesValidator, accessTagChangeChecker });
    return { checker, tagCheckerSpy, accessCheckSpy, tagChangeSpy };
};

describe('AdminResultAccessChecker', () => {
    test.each([
        {
            name: 'allows a created Person the caller can create',
            candidateCodes: ['client'],
            expectedText: null
        },
        {
            name: 'fails a created Person of another tenant',
            candidateCodes: ['other-tenant'],
            expectedText: 'user synthetic-user has no access to resource Person with id synthetic-person-0'
        },
        {
            name: 'fails a created Person of a tenant the caller can only read',
            candidateCodes: ['reader'],
            expectedText: 'user synthetic-user has no access to resource Person with id synthetic-person-0'
        },
        {
            name: 'fails a created Person that adds an access tag the caller cannot create',
            candidateCodes: ['client', 'reader'],
            expectedText:
                'user synthetic-user can only add or remove access tags it has write access to, ' +
                'for resource Person with id synthetic-person-0'
        }
    ])('$name', async ({ candidateCodes, expectedText }) => {
        const { checker } = buildChecker();
        const item = buildItem({ storedCodes: null, candidateCodes });

        const failures = await checker.checkAsync({ items: [item], context: buildContext(), accessRequested: 'u' });

        expect(failures).toHaveLength(1);
        if (expectedText === null) {
            expect(failures[0]).toBeNull();
            return;
        }
        expect(failures[0]).toBeInstanceOf(WriteFailure);
        expect(failures[0].stage).toBe(WRITE_FAILURE_STAGE.ACCESS);
        expect(failures[0].subject).toStrictEqual(WriteFailure.subjectOf(item.incoming));
        expect(failures[0].error).toBeNull();
        expect(failures[0].operationOutcome.issue[0].code).toBe('forbidden');
        expect(failures[0].operationOutcome.issue[0].details.text).toBe(expectedText);
    });

    test('checks a created Person\'s access and its access-tag change from nothing with c', async () => {
        const { checker, tagCheckerSpy, accessCheckSpy, tagChangeSpy } = buildChecker();
        const item = buildItem({ storedCodes: null, candidateCodes: ['client'] });

        await checker.checkAsync({ items: [item], context: buildContext(), accessRequested: 'u' });

        expect(accessCheckSpy.mock.calls.map(([args]) => args)).toStrictEqual([
            { requestInfo: REQUEST_INFO, resource: item.candidate, base_version: '4_0_0', accessRequested: 'c' }
        ]);
        expect(tagChangeSpy.mock.calls.map(([args]) => args)).toStrictEqual([
            { requestInfo: REQUEST_INFO, currentResource: null, updatedResource: item.candidate, accessRequested: 'c' }
        ]);
        expect(tagCheckerSpy.mock.calls.flatMap(([args]) => args.items)).toStrictEqual([]);
    });

    test('delegates the updated items to the access-tag change checker', async () => {
        const { checker, tagCheckerSpy, accessCheckSpy } = buildChecker();
        const allowed = buildItem({ index: 0, storedCodes: ['client'], candidateCodes: ['client'] });
        const created = buildItem({ index: 1, storedCodes: null, candidateCodes: ['client'] });
        const forbidden = buildItem({ index: 2, storedCodes: ['client'], candidateCodes: ['client', 'other-tenant'] });
        const context = buildContext();

        const failures = await checker.checkAsync({
            items: [allowed, created, forbidden],
            context,
            accessRequested: 'u'
        });

        expect(tagCheckerSpy).toHaveBeenCalledTimes(1);
        expect(tagCheckerSpy.mock.calls[0][0]).toStrictEqual({
            items: [allowed, forbidden],
            context,
            accessRequested: 'u'
        });
        expect(accessCheckSpy.mock.calls.map(([args]) => args.resource)).toStrictEqual([created.candidate]);
        expect(failures[0]).toBeNull();
        expect(failures[1]).toBeNull();
        expect(failures[2]).toBeInstanceOf(WriteFailure);
        expect(failures[2].stage).toBe(WRITE_FAILURE_STAGE.ACCESS);
        expect(failures[2].subject).toStrictEqual(WriteFailure.subjectOf(forbidden.incoming));
    });

    test('skips a no-op item', async () => {
        const { checker, tagCheckerSpy, accessCheckSpy, tagChangeSpy } = buildChecker();
        const items = [
            buildItem({ index: 0, storedCodes: null, candidateCodes: null }),
            buildItem({ index: 1, storedCodes: ['client', 'other-tenant'], candidateCodes: null })
        ];

        const failures = await checker.checkAsync({ items, context: buildContext(), accessRequested: 'u' });

        expect(failures).toStrictEqual([null, null]);
        expect(tagCheckerSpy.mock.calls.flatMap(([args]) => args.items)).toStrictEqual([]);
        expect(accessCheckSpy).not.toHaveBeenCalled();
        expect(tagChangeSpy).not.toHaveBeenCalled();
    });

    test('returns one entry per item, in item order', async () => {
        const { checker } = buildChecker();
        const items = [
            buildItem({ index: 0, storedCodes: ['client'], candidateCodes: ['client', 'other-tenant'] }),
            buildItem({ index: 1, storedCodes: null, candidateCodes: ['client'] }),
            buildItem({ index: 2, storedCodes: null, candidateCodes: ['other-tenant'] }),
            buildItem({ index: 3, storedCodes: ['client'], candidateCodes: null }),
            buildItem({ index: 4, storedCodes: ['client'], candidateCodes: ['client'] })
        ];

        const failures = await checker.checkAsync({ items, context: buildContext(), accessRequested: 'u' });

        expect(failures.map((failure) => failure?.stage ?? null)).toStrictEqual([
            WRITE_FAILURE_STAGE.ACCESS,
            null,
            WRITE_FAILURE_STAGE.ACCESS,
            null,
            null
        ]);
        expect(failures.map((failure) => failure?.subject.id ?? null)).toStrictEqual([
            items[0].incoming.id,
            null,
            items[2].incoming.id,
            null,
            null
        ]);
    });

    test.each([
        {
            name: 'the access check of a created Person',
            storedCodes: null,
            method: 'isAccessToResourceAllowedByAccessAndPatientScopes'
        },
        {
            name: 'the access-tag change check of a created Person',
            storedCodes: null,
            method: 'isAccessTagChangeAllowedByAccessScopes'
        },
        {
            name: 'the access-tag change check of an updated item',
            storedCodes: ['client'],
            method: 'isAccessTagChangeAllowedByAccessScopes'
        }
    ])('lets a non-403 error from $name through', async ({ storedCodes, method }) => {
        const { checker, accessCheckSpy, tagChangeSpy } = buildChecker();
        const error = new Error('synthetic failure');
        const spy = method === 'isAccessTagChangeAllowedByAccessScopes' ? tagChangeSpy : accessCheckSpy;
        spy.mockImplementation(() => {
            throw error;
        });
        const items = [buildItem({ storedCodes, candidateCodes: ['client'] })];

        await expect(
            checker.checkAsync({ items, context: buildContext(), accessRequested: 'u' })
        ).rejects.toBe(error);
    });
});
