const { describe, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../../../utils/configManager');
const { PreSaveManager } = require('../../../../../preSaveHandlers/preSave');
const { DatabaseAttachmentManager } = require('../../../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../../../dataLayer/base64DataManager');
const { AttachmentsStep } = require('../../../../../operations/writePipeline/steps/attachmentsStep');
const { WriteItem, WRITE_ITEM_STATUS } = require('../../../../../operations/writePipeline/writeItem');
const { WriteContext } = require('../../../../../operations/writePipeline/writeContext');
const { BLOB_OP } = require('../../../../../constants');

const requestInfo = { requestId: 'request-1', headers: {}, path: '/4_0_0/Patient/patient-1' };

const context = new WriteContext({
    requestInfo,
    base_version: '4_0_0',
    parsedArgs: {},
    smartMerge: false
});

/**
 * Builds the step with managers that pass the document through, and records every call to the
 * base64 manager's `transformAsync` in `base64Calls`. Extra constructor options go in `options`.
 */
const buildStep = ({ base64Calls, options = {} }) => {
    const preSaveManager = Object.create(PreSaveManager.prototype);
    preSaveManager.preSaveAsync = async ({ resource }) => resource;
    const databaseAttachmentManager = Object.create(DatabaseAttachmentManager.prototype);
    databaseAttachmentManager.transformAttachments = async (doc) => doc;
    const base64DataManager = Object.create(Base64DataManager.prototype);
    base64DataManager.transformAsync = async (...args) => {
        base64Calls.push(args);
        return args[0];
    };
    return new AttachmentsStep({
        preSaveManager,
        databaseAttachmentManager,
        base64DataManager,
        configManager: new ConfigManager(),
        ...options
    });
};

/**
 * Builds an item with a built document to insert.
 */
const buildItem = () => {
    const incoming = { resourceType: 'Patient', id: 'patient-1' };
    const item = new WriteItem({ index: 0, incoming });
    item.writeMode = 'insert';
    item.candidate = { ...incoming };
    return item;
};

describe('AttachmentsStep base64 insert', () => {
    test('passes alwaysCreateNew to the base64 insert when asked', async () => {
        const base64Calls = [];
        const step = buildStep({ base64Calls, options: { alwaysCreateNewBase64: true } });
        const item = buildItem();

        await step.runAsync({ items: [item], context });

        expect(item.status).toBe(WRITE_ITEM_STATUS.ACTIVE);
        expect(base64Calls).toStrictEqual([
            [item.candidate, BLOB_OP.INSERT, requestInfo, { alwaysCreateNew: true }]
        ]);
    });

    test('does not pass it by default', async () => {
        const base64Calls = [];
        const step = buildStep({ base64Calls });
        const item = buildItem();

        await step.runAsync({ items: [item], context });

        expect(item.status).toBe(WRITE_ITEM_STATUS.ACTIVE);
        expect(base64Calls).toStrictEqual([[item.candidate, BLOB_OP.INSERT, requestInfo]]);
    });
});
