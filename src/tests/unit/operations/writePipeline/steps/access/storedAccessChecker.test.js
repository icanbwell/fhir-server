const { describe, test, expect, jest } = require('@jest/globals');
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
 * The caller's request info: a synthetic user that holds the update access scope of one tenant.
 */
const REQUEST_INFO = Object.freeze({
    requestId: 'synthetic-request',
    user: 'synthetic-user',
    scope: 'user/*.* access/client.*',
    isUser: false
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
 * Builds a Patient owned by `tenant` and tagged for `tenant`'s access, as a stored document is.
 */
const buildPatient = ({ id = 'synthetic-patient', tenant }) => ({
    resourceType: 'Patient',
    id,
    _uuid: ITEM_UUID,
    _sourceAssigningAuthority: 'client',
    meta: {
        security: [
            { system: SecurityTagSystem.owner, code: tenant },
            { system: SecurityTagSystem.access, code: tenant }
        ]
    }
});

/**
 * Builds an item whose stored document belongs to `tenant`, and whose incoming stub has the
 * identity the loader copied onto it.
 */
const buildItem = ({ index = 0, id = 'synthetic-patient', tenant }) => {
    const item = new WriteItem({
        index,
        incoming: {
            resourceType: 'Patient',
            id,
            _uuid: ITEM_UUID,
            _sourceAssigningAuthority: 'client'
        }
    });
    item.stored = buildPatient({ id, tenant });
    return item;
};

/**
 * Builds the real scopes validator on a real scopes manager, so the access scope rules are the
 * production ones. The patient scope manager is the one boundary that reaches the database, so it
 * is faked: `canWriteResourceAsync` returns `canWrite`, or throws `error`.
 */
const buildScopesValidator = ({ canWrite = true, error = null } = {}) => {
    const patientScopeManager = Object.create(PatientScopeManager.prototype);
    patientScopeManager.canWriteResourceAsync = async () => {
        if (error) {
            throw error;
        }
        return canWrite;
    };
    const scopesValidator = Object.create(ScopesValidator.prototype);
    scopesValidator.scopesManager = new ScopesManager({
        configManager: Object.create(ConfigManager.prototype),
        patientFilterManager: new PatientFilterManager()
    });
    scopesValidator.patientScopeManager = patientScopeManager;
    scopesValidator.preSaveManager = new PreSaveManager({ preSaveHandlers: [] });
    return scopesValidator;
};

describe('StoredAccessChecker', () => {
    test('allows an accessible stored doc', async () => {
        const checker = new StoredAccessChecker({ scopesValidator: buildScopesValidator() });
        const items = [buildItem({ tenant: 'client' })];

        const failures = await checker.checkAsync({ items, context: buildContext(), accessRequested: 'u' });

        expect(failures).toStrictEqual([null]);
    });

    test('fails a forbidden stored doc at ACCESS with the validator\'s text', async () => {
        const checker = new StoredAccessChecker({ scopesValidator: buildScopesValidator() });
        const items = [buildItem({ tenant: 'other-tenant' })];

        const failures = await checker.checkAsync({ items, context: buildContext(), accessRequested: 'u' });

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
        expect(failures[0].operationOutcome.issue[0].details.text).toBe(
            'user synthetic-user has no access to resource Patient with id synthetic-patient'
        );
    });

    test('fails a stored doc the patient scope does not allow writing at ACCESS', async () => {
        const checker = new StoredAccessChecker({
            scopesValidator: buildScopesValidator({ canWrite: false })
        });
        const items = [buildItem({ tenant: 'client' })];

        const failures = await checker.checkAsync({ items, context: buildContext(), accessRequested: 'u' });

        expect(failures[0].stage).toBe(WRITE_FAILURE_STAGE.ACCESS);
        expect(failures[0].operationOutcome.issue[0].details.text).toBe(
            'The current patient scope and person id in the JWT token do not allow writing the Patient resource.'
        );
    });

    test('lets a non-403 error through', async () => {
        const error = new Error('synthetic failure');
        const checker = new StoredAccessChecker({ scopesValidator: buildScopesValidator({ error }) });
        const items = [buildItem({ tenant: 'client' })];

        await expect(
            checker.checkAsync({ items, context: buildContext(), accessRequested: 'u' })
        ).rejects.toBe(error);
    });

    test.each(['u', 'c'])(
        'checks the stored doc of each item with the request info, base version and accessRequested %s',
        async (accessRequested) => {
            const scopesValidator = buildScopesValidator();
            const checkSpy = jest.spyOn(scopesValidator, 'isAccessToResourceAllowedByAccessAndPatientScopes');
            const checker = new StoredAccessChecker({ scopesValidator });
            const items = [
                buildItem({ index: 0, id: 'synthetic-patient-1', tenant: 'client' }),
                buildItem({ index: 1, id: 'synthetic-patient-2', tenant: 'client' })
            ];

            await checker.checkAsync({ items, context: buildContext(), accessRequested });

            expect(checkSpy.mock.calls.map(([args]) => args)).toStrictEqual(
                items.map((item) => ({
                    requestInfo: REQUEST_INFO,
                    resource: item.stored,
                    base_version: '4_0_0',
                    accessRequested
                }))
            );
        }
    );

    test('returns one entry per item, in item order', async () => {
        const checker = new StoredAccessChecker({ scopesValidator: buildScopesValidator() });
        const items = [
            buildItem({ index: 0, id: 'synthetic-patient-1', tenant: 'client' }),
            buildItem({ index: 1, id: 'synthetic-patient-2', tenant: 'other-tenant' }),
            buildItem({ index: 2, id: 'synthetic-patient-3', tenant: 'client' })
        ];

        const failures = await checker.checkAsync({ items, context: buildContext(), accessRequested: 'u' });

        expect(failures.map((failure) => failure?.stage ?? null)).toStrictEqual([
            null,
            WRITE_FAILURE_STAGE.ACCESS,
            null
        ]);
        expect(failures[1].subject.id).toBe('synthetic-patient-2');
    });
});
