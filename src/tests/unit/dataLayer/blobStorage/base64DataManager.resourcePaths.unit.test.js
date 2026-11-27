'use strict';

const { afterEach, describe, expect, test } = require('@jest/globals');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { MockS3Client } = require('../../../integration/export/mocks/s3Client');
const { ConfigManager } = require('../../../../utils/configManager');
const { RequestSpecificCache } = require('../../../../utils/requestSpecificCache');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { BLOB_OP } = require('../../../../constants');

const ENV_KEYS = [
    'BASE64_FIELD_CLOUD_STORAGE_ENABLED',
    'BASE64_FIELD_CLOUD_STORAGE_DOCUMENT_REFERENCE_ENABLED',
    'BASE64_FIELD_DATA_THRESHOLD_KB'
];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

// Base64DataManager's constructor checks real instances, so build real ones (as the other unit
// tests of this manager do). The DocumentReference flag decides whether its paths are configured.
function makeManager({ documentReferenceFlag }) {
    process.env.BASE64_FIELD_CLOUD_STORAGE_ENABLED = '1';
    process.env.BASE64_FIELD_DATA_THRESHOLD_KB = '0';
    if (documentReferenceFlag) {
        process.env.BASE64_FIELD_CLOUD_STORAGE_DOCUMENT_REFERENCE_ENABLED = '1';
    } else {
        delete process.env.BASE64_FIELD_CLOUD_STORAGE_DOCUMENT_REFERENCE_ENABLED;
    }
    const client = new MockS3Client({ bucketName: 'b', region: 'us-east-1' });
    return new Base64DataManager({
        base64FieldCloudStorageClient: client,
        historyResourceCloudStorageClient: client,
        configManager: new ConfigManager(),
        requestSpecificCache: new RequestSpecificCache(),
        preSaveManager: new PreSaveManager({ preSaveHandlers: [] })
    });
}

afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
});

describe('Base64DataManager DocumentReference resourcePaths gate', () => {
    test('flag off: only Binary is externalized, DocumentReference stays in resourcePaths to protect pointers', () => {
        const manager = makeManager({ documentReferenceFlag: false });

        expect(Object.keys(manager.externalizationPaths)).toEqual(['Binary']);
        expect(Object.keys(manager.resourcePaths).sort()).toEqual(['Binary', 'DocumentReference']);
    });

    test('flag on: DocumentReference has the three attachment paths in both sets', () => {
        const manager = makeManager({ documentReferenceFlag: true });

        expect(manager.externalizationPaths.Binary).toBeDefined();
        expect(manager.externalizationPaths.DocumentReference.map((e) => e.dataPath)).toEqual([
            '/content/[]/attachment/data',
            '/extension/[]/valueAttachment/data',
            '/modifierExtension/[]/valueAttachment/data'
        ]);
        expect(manager.resourcePaths.DocumentReference).toEqual(manager.externalizationPaths.DocumentReference);
    });

    test('flag off: INSERT and RETRIEVE return DocumentReference untouched, data and sidecar alike', async () => {
        const manager = makeManager({ documentReferenceFlag: false });
        const resource = {
            resourceType: 'DocumentReference',
            id: 'd1',
            content: [{ attachment: { _blobMeta: { hash: 'h', rawSize: 1 } } }]
        };

        const insert = await manager.transformAsync(
            JSON.parse(JSON.stringify(resource)), BLOB_OP.INSERT, { requestId: 'r1' }
        );
        const retrieve = await manager.transformAsync(
            JSON.parse(JSON.stringify(resource)), BLOB_OP.RETRIEVE, { requestId: 'r1' }
        );

        expect(insert).toEqual(resource);
        expect(retrieve).toEqual(resource);
    });
});
