const { describe, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../../../utils/configManager');
const { ResourceValidator } = require('../../../../../operations/common/resourceValidator');
const { RemoteFhirValidator } = require('../../../../../utils/remoteFhirValidator');
const { DatabaseQueryFactory } = require('../../../../../dataLayer/databaseQueryFactory');
const { DatabaseUpdateFactory } = require('../../../../../dataLayer/databaseUpdateFactory');
const { ScopesManager } = require('../../../../../operations/security/scopesManager');
const { PatientFilterManager } = require('../../../../../fhir/patientFilterManager');
const { ValidateNewResourceStep } = require('../../../../../operations/writePipeline/steps/validateNewResourceStep');
const { WriteItem, WRITE_ITEM_STATUS } = require('../../../../../operations/writePipeline/writeItem');
const { WRITE_FAILURE_STAGE } = require('../../../../../operations/writePipeline/writeFailure');

/**
 * Builds a `ResourceValidator` with the real config and scopes manager; it reaches no database.
 */
const buildResourceValidator = () => new ResourceValidator({
    configManager: new ConfigManager(),
    remoteFhirValidator: Object.create(RemoteFhirValidator.prototype),
    databaseQueryFactory: Object.create(DatabaseQueryFactory.prototype),
    databaseUpdateFactory: Object.create(DatabaseUpdateFactory.prototype),
    scopesManager: Object.create(ScopesManager.prototype),
    patientFilterManager: Object.create(PatientFilterManager.prototype)
});

/**
 * Builds a Patient item with a UUID id and no owner tag, which fails the meta check, and the given
 * stored document.
 */
const buildItemWithoutOwnerTag = (stored) => {
    const item = new WriteItem({
        index: 0,
        incoming: {
            resourceType: 'Patient',
            id: '00000000-0000-4000-8000-0000000000e1',
            _uuid: '00000000-0000-4000-8000-0000000000e1',
            meta: {
                source: 'http://example.com/source',
                security: [{ system: 'https://www.icanbwell.com/access', code: 'client' }]
            }
        }
    });
    item.stored = stored;
    return item;
};

describe('ValidateNewResourceStep', () => {
    test.each([
        {
            name: 'no stored document',
            stored: null,
            status: WRITE_ITEM_STATUS.FAILED,
            stage: WRITE_FAILURE_STAGE.INCOMING_META
        },
        {
            name: 'a stored document',
            stored: { resourceType: 'Patient', id: '00000000-0000-4000-8000-0000000000e1' },
            status: WRITE_ITEM_STATUS.ACTIVE,
            stage: null
        }
    ])('checks the meta of an item without an owner tag only when it has $name', async ({
        stored,
        status,
        stage
    }) => {
        const item = buildItemWithoutOwnerTag(stored);
        const step = new ValidateNewResourceStep({ resourceValidator: buildResourceValidator() });

        await step.runAsync({ items: [item] });

        expect(item.status).toBe(status);
        expect(item.failure?.stage ?? null).toBe(stage);
    });
});
