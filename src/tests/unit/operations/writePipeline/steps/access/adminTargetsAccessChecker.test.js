const { describe, test, expect, jest } = require('@jest/globals');
const { AdminTargetsAccessChecker } = require('../../../../../../operations/writePipeline/steps/access/adminTargetsAccessChecker');
const { StoredAccessChecker } = require('../../../../../../operations/writePipeline/steps/access/storedAccessChecker');
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
 * Builds a stored document of `resourceType` owned by `tenant` and tagged for `tenant`'s access.
 */
const buildStored = ({ resourceType, id, uuid, tenant }) => ({
    resourceType,
    id,
    _uuid: uuid,
    _sourceAssigningAuthority: tenant,
    meta: {
        security: [
            { system: SecurityTagSystem.owner, code: tenant },
            { system: SecurityTagSystem.access, code: tenant }
        ]
    }
});

/**
 * Builds an admin item that changes a Person and links a Patient. A `null` `personTenant` makes it
 * a Person about to be created, with no stored document; otherwise the stored Person belongs to
 * `personTenant` and its identity is on `incoming`, as the loader leaves it. The linked Patient
 * belongs to `patientTenant`.
 */
const buildItem = ({ index = 0, personTenant, patientTenant }) => {
    const personUuid = `00000000-0000-4000-8000-0000000000a${index}`;
    const item = new WriteItem({ index, incoming: { resourceType: 'Person', id: personUuid } });
    if (personTenant !== null) {
        item.stored = buildStored({
            resourceType: 'Person',
            id: `synthetic-person-${index}`,
            uuid: personUuid,
            tenant: personTenant
        });
        item.incoming.id = item.stored.id;
        item.incoming._uuid = item.stored._uuid;
        item.incoming._sourceAssigningAuthority = item.stored._sourceAssigningAuthority;
    }
    item.linked.push({
        resourceType: 'Patient',
        resource: buildStored({
            resourceType: 'Patient',
            id: `synthetic-patient-${index}`,
            uuid: `00000000-0000-4000-8000-0000000000b${index}`,
            tenant: patientTenant
        })
    });
    return item;
};

/**
 * Builds the real scopes validator on a real scopes manager, so the access scope rules are the
 * production ones. The patient scope manager is the one boundary that reaches the database, so it
 * is faked to allow every write.
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
 * Builds the checker on the real stored access checker and scopes validator, with spies on the
 * stored access checker and the validator's access check, so a test can see what each received.
 */
const buildChecker = () => {
    const scopesValidator = buildScopesValidator();
    const storedAccessChecker = new StoredAccessChecker({ scopesValidator });
    const storedCheckSpy = jest.spyOn(storedAccessChecker, 'checkAsync');
    const accessCheckSpy = jest.spyOn(scopesValidator, 'isAccessToResourceAllowedByAccessAndPatientScopes');
    const checker = new AdminTargetsAccessChecker({ storedAccessChecker, scopesValidator });
    return { checker, storedCheckSpy, accessCheckSpy };
};

describe('AdminTargetsAccessChecker', () => {
    test.each([
        {
            name: 'allows an accessible target and linked resource',
            personTenant: 'client',
            patientTenant: 'client',
            expectedText: null
        },
        {
            name: 'allows a linked resource the caller can only read',
            personTenant: 'client',
            patientTenant: 'reader',
            expectedText: null
        },
        {
            name: 'allows a Person about to be created whose linked resource is accessible',
            personTenant: null,
            patientTenant: 'client',
            expectedText: null
        },
        {
            name: 'fails a forbidden target',
            personTenant: 'other-tenant',
            patientTenant: 'client',
            expectedText: 'user synthetic-user has no access to resource Person with id synthetic-person-0'
        },
        {
            name: 'fails a target the caller can only read',
            personTenant: 'reader',
            patientTenant: 'client',
            expectedText: 'user synthetic-user has no access to resource Person with id synthetic-person-0'
        },
        {
            name: 'fails the item of a forbidden linked resource',
            personTenant: 'client',
            patientTenant: 'other-tenant',
            expectedText: 'user synthetic-user has no access to resource Patient with id synthetic-patient-0'
        },
        {
            name: 'fails a Person about to be created whose linked resource is forbidden',
            personTenant: null,
            patientTenant: 'other-tenant',
            expectedText: 'user synthetic-user has no access to resource Patient with id synthetic-patient-0'
        },
        {
            name: 'fails with the target failure when the target and the linked resource are forbidden',
            personTenant: 'other-tenant',
            patientTenant: 'other-tenant',
            expectedText: 'user synthetic-user has no access to resource Person with id synthetic-person-0'
        }
    ])('$name', async ({ personTenant, patientTenant, expectedText }) => {
        const { checker } = buildChecker();
        const item = buildItem({ personTenant, patientTenant });

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

    test('checks the targets through the stored access checker and each linked resource with r', async () => {
        const { checker, storedCheckSpy, accessCheckSpy } = buildChecker();
        const updated = buildItem({ index: 0, personTenant: 'client', patientTenant: 'client' });
        const created = buildItem({ index: 1, personTenant: null, patientTenant: 'client' });
        const context = buildContext();

        await checker.checkAsync({ items: [updated, created], context, accessRequested: 'u' });

        expect(storedCheckSpy).toHaveBeenCalledTimes(1);
        expect(storedCheckSpy.mock.calls[0][0]).toStrictEqual({ items: [updated], context, accessRequested: 'u' });
        expect(accessCheckSpy.mock.calls.map(([args]) => args)).toStrictEqual([
            { requestInfo: REQUEST_INFO, resource: updated.stored, base_version: '4_0_0', accessRequested: 'u' },
            {
                requestInfo: REQUEST_INFO,
                resource: updated.linked[0].resource,
                base_version: '4_0_0',
                accessRequested: 'r'
            },
            {
                requestInfo: REQUEST_INFO,
                resource: created.linked[0].resource,
                base_version: '4_0_0',
                accessRequested: 'r'
            }
        ]);
    });

    test('checks the target with the access letter it is given and the linked resource with r', async () => {
        const { checker, accessCheckSpy } = buildChecker();
        const item = buildItem({ personTenant: 'client', patientTenant: 'client' });

        await checker.checkAsync({ items: [item], context: buildContext(), accessRequested: 'u' });

        expect(accessCheckSpy.mock.calls.map(([args]) => [args.resource, args.accessRequested])).toStrictEqual([
            [item.stored, 'u'],
            [item.linked[0].resource, 'r']
        ]);
    });

    test('passes a linked resource the caller can only read', async () => {
        const { checker } = buildChecker();
        const item = buildItem({ personTenant: 'client', patientTenant: 'reader' });

        const [failure] = await checker.checkAsync({ items: [item], context: buildContext(), accessRequested: 'u' });

        expect(failure).toBeNull();
    });

    test('does not check the linked resources of an item whose target is forbidden', async () => {
        const { checker, accessCheckSpy } = buildChecker();
        const item = buildItem({ personTenant: 'other-tenant', patientTenant: 'client' });

        await checker.checkAsync({ items: [item], context: buildContext(), accessRequested: 'u' });

        expect(accessCheckSpy.mock.calls.map(([args]) => args.resource)).toStrictEqual([item.stored]);
    });

    test('checks every linked resource of an item', async () => {
        const { checker, accessCheckSpy } = buildChecker();
        const item = buildItem({ personTenant: 'client', patientTenant: 'client' });
        const forbiddenLinked = buildStored({
            resourceType: 'Patient',
            id: 'synthetic-patient-second',
            uuid: '00000000-0000-4000-8000-0000000000c0',
            tenant: 'other-tenant'
        });
        item.linked.push({ resourceType: 'Patient', resource: forbiddenLinked });

        const failures = await checker.checkAsync({ items: [item], context: buildContext(), accessRequested: 'u' });

        expect(accessCheckSpy.mock.calls.map(([args]) => args.resource)).toStrictEqual([
            item.stored,
            item.linked[0].resource,
            forbiddenLinked
        ]);
        expect(failures[0].operationOutcome.issue[0].details.text).toBe(
            'user synthetic-user has no access to resource Patient with id synthetic-patient-second'
        );
    });

    test('returns one entry per item, in item order', async () => {
        const { checker } = buildChecker();
        const items = [
            buildItem({ index: 0, personTenant: null, patientTenant: 'other-tenant' }),
            buildItem({ index: 1, personTenant: 'client', patientTenant: 'client' }),
            buildItem({ index: 2, personTenant: 'other-tenant', patientTenant: 'client' }),
            buildItem({ index: 3, personTenant: null, patientTenant: 'client' })
        ];

        const failures = await checker.checkAsync({ items, context: buildContext(), accessRequested: 'u' });

        expect(failures.map((failure) => failure?.operationOutcome.issue[0].details.text ?? null)).toStrictEqual([
            'user synthetic-user has no access to resource Patient with id synthetic-patient-0',
            null,
            'user synthetic-user has no access to resource Person with id synthetic-person-2',
            null
        ]);
        expect(failures[0].subject).toStrictEqual(WriteFailure.subjectOf(items[0].incoming));
        expect(failures[2].subject).toStrictEqual(WriteFailure.subjectOf(items[2].incoming));
    });

    test.each([
        { name: 'the target', resourceType: 'Person' },
        { name: 'a linked resource', resourceType: 'Patient' }
    ])('lets a non-403 error from the check of $name through', async ({ resourceType }) => {
        const { checker, accessCheckSpy } = buildChecker();
        const error = new Error('synthetic failure');
        accessCheckSpy.mockImplementation(async ({ resource }) => {
            if (resource.resourceType === resourceType) {
                throw error;
            }
        });
        const items = [buildItem({ personTenant: 'client', patientTenant: 'client' })];

        await expect(
            checker.checkAsync({ items, context: buildContext(), accessRequested: 'u' })
        ).rejects.toBe(error);
    });
});
