'use strict';

const { describe, test, beforeEach, afterEach, expect, jest } = require('@jest/globals');
const deepcopy = require('deepcopy');
const { FastDatabaseBulkInserter } = require('../../../dataLayer/fastDatabaseBulkInserter');
const { RequestSpecificCache } = require('../../../utils/requestSpecificCache');
const { ResourceManager } = require('../../../operations/common/resourceManager');
const { PostRequestProcessor } = require('../../../utils/postRequestProcessor');
const { ResourceLocatorFactory } = require('../../../operations/common/resourceLocatorFactory');
const { PreSaveManager } = require('../../../preSaveHandlers/preSave');
const { DatabaseUpdateFactory } = require('../../../dataLayer/databaseUpdateFactory');
const { ResourceMerger } = require('../../../operations/common/resourceMerger');
const { ConfigManager } = require('../../../utils/configManager');
const { PostSaveProcessor } = require('../../../dataLayer/postSaveProcessor');
const { Base64DataManager } = require('../../../dataLayer/base64DataManager');
const { FhirRequestInfo } = require('../../../utils/fhirRequestInfo');
const { CustomTracer } = require('../../../utils/customTracer');
const BaseSerializer = require('../../../fhir/writeSerializers/4_0_0/customSerializers/baseSerializer');

const BASE_VERSION = '4_0_0';
const REQUEST_ID = 'history-document-request';

function createPrototypedMock(RealClass) {
    return Object.create(RealClass.prototype);
}

function createRequestInfo() {
    const info = createPrototypedMock(FhirRequestInfo);
    info.requestId = REQUEST_ID;
    info.userRequestId = 'u-1';
    info.method = 'DELETE';
    info.headers = {};
    return info;
}

function createDeps() {
    const postRequestProcessor = createPrototypedMock(PostRequestProcessor);
    postRequestProcessor.add = jest.fn();
    const base64DataManager = createPrototypedMock(Base64DataManager);
    base64DataManager.transformHistoryAsync = jest.fn().mockImplementation(async (doc) => doc);
    const customTracer = createPrototypedMock(CustomTracer);
    customTracer.trace = jest.fn().mockImplementation(async ({ func }) => await func());
    return {
        resourceManager: createPrototypedMock(ResourceManager),
        postRequestProcessor,
        resourceLocatorFactory: createPrototypedMock(ResourceLocatorFactory),
        preSaveManager: createPrototypedMock(PreSaveManager),
        requestSpecificCache: new RequestSpecificCache(),
        databaseUpdateFactory: createPrototypedMock(DatabaseUpdateFactory),
        resourceMerger: createPrototypedMock(ResourceMerger),
        configManager: createPrototypedMock(ConfigManager),
        postSaveProcessor: createPrototypedMock(PostSaveProcessor),
        base64DataManager,
        bulkWriteExecutors: [],
        customTracer
    };
}

async function buildHistoryDoc(resourceType, input) {
    const inserter = new FastDatabaseBulkInserter(createDeps());
    await inserter.insertOneHistoryAsync({
        requestInfo: createRequestInfo(),
        base_version: BASE_VERSION,
        resourceType,
        doc: deepcopy(input)
    });
    const historyDoc = inserter
        .getHistoryOperationsByResourceTypeMap({ requestId: REQUEST_ID })
        .get(resourceType)[0].operation.insertOne.document;
    expect(historyDoc._recorded).toBeInstanceOf(Date);
    delete historyDoc._recorded;
    return historyDoc;
}

const securityTags = () => [
    { system: 'https://www.icanbwell.com/owner', code: 'client' },
    { system: 'https://www.icanbwell.com/access', code: 'client' },
    { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'client' }
];

function patientDoc(overrides = {}) {
    return {
        resourceType: 'Patient',
        id: 'patient-1',
        meta: {
            versionId: '3',
            lastUpdated: new Date('2026-10-26T10:00:00.000Z'),
            source: 'http://example.com/source',
            security: securityTags()
        },
        identifier: [{ system: 'http://example.com/mrn', value: 'mrn-1' }],
        name: [{ family: 'Doe', given: ['Jane'] }],
        gender: 'female',
        _uuid: '11111111-1111-5111-9111-111111111111',
        _sourceId: 'patient-1',
        _access: { client: 1 },
        _sourceAssigningAuthority: 'client',
        ...overrides
    };
}

describe('FastDatabaseBulkInserter history document', () => {
    let previousSerializerConfig;

    beforeEach(() => {
        previousSerializerConfig = BaseSerializer.configManager;
        BaseSerializer.setConfigManager({ preSaveCodingIdUpdateResources: [] });
    });

    afterEach(() => {
        BaseSerializer.setConfigManager(previousSerializerConfig);
    });

    test('a plain Patient doc is stored as the history resource with its internal fields', async () => {
        const historyDoc = await buildHistoryDoc('Patient', patientDoc());

        expect(historyDoc.resource).toStrictEqual(patientDoc());
        expect(historyDoc.resource._uuid).toBe('11111111-1111-5111-9111-111111111111');
        expect(historyDoc.resource._sourceId).toBe('patient-1');
        expect(historyDoc.resource._access).toStrictEqual({ client: 1 });
        expect(historyDoc.resource._sourceAssigningAuthority).toBe('client');
    });

    test('the Mongo _id is not carried into the history resource', async () => {
        const historyDoc = await buildHistoryDoc('Patient', patientDoc({ _id: '6530f0f0f0f0f0f0f0f0f0f0' }));

        expect(historyDoc.resource._id).toBeUndefined();
        expect(historyDoc.resource).toStrictEqual(patientDoc());
    });

    test('meta.lastUpdated stays a Date with the same instant', async () => {
        const lastUpdated = new Date('2026-10-26T12:34:56.789Z');
        const input = patientDoc();
        input.meta.lastUpdated = lastUpdated;

        const historyDoc = await buildHistoryDoc('Patient', input);

        expect(historyDoc.resource.meta.lastUpdated).toBeInstanceOf(Date);
        expect(historyDoc.resource.meta.lastUpdated.getTime()).toBe(lastUpdated.getTime());
    });

    test('a Binary keeps _blobMeta and has no data', async () => {
        const input = {
            resourceType: 'Binary',
            id: 'binary-1',
            meta: { versionId: '1', lastUpdated: new Date('2026-10-26T10:00:00.000Z'), security: securityTags() },
            contentType: 'application/pdf',
            _blobMeta: { hash: 'abc123', rawSize: 2048, lastUpdated: '2026-10-26T10:00:00.000Z' },
            _uuid: '22222222-2222-5222-9222-222222222222',
            _sourceId: 'binary-1',
            _access: { client: 1 },
            _sourceAssigningAuthority: 'client'
        };

        const historyDoc = await buildHistoryDoc('Binary', input);

        expect(historyDoc.resource).toStrictEqual(input);
        expect(historyDoc.resource._blobMeta).toStrictEqual(input._blobMeta);
        expect(historyDoc.resource.data).toBeUndefined();
    });

    test('a DocumentReference attachment keeps its _file_id', async () => {
        const input = {
            resourceType: 'DocumentReference',
            id: 'docref-1',
            meta: { versionId: '1', lastUpdated: new Date('2026-10-26T10:00:00.000Z'), security: securityTags() },
            status: 'current',
            content: [{ attachment: { contentType: 'application/pdf', _file_id: '6530f0f0f0f0f0f0f0f0f0f1' } }],
            _uuid: '33333333-3333-5333-9333-333333333333',
            _sourceId: 'docref-1',
            _access: { client: 1 },
            _sourceAssigningAuthority: 'client'
        };

        const historyDoc = await buildHistoryDoc('DocumentReference', input);

        expect(historyDoc.resource).toStrictEqual(input);
        expect(historyDoc.resource.content[0].attachment._file_id).toBe('6530f0f0f0f0f0f0f0f0f0f1');
    });

    test('a raw GroupMember row keeps its group uuid and member entity fields', async () => {
        const input = {
            resourceType: 'GroupMember',
            id: '44444444-4444-5444-9444-444444444444',
            meta: { versionId: '2', lastUpdated: new Date('2026-10-26T10:00:00.000Z'), security: securityTags() },
            groupUuid: '55555555-5555-5555-9555-555555555555',
            member: {
                entity: {
                    reference: 'Patient/patient-1|client',
                    _uuid: 'Patient/11111111-1111-5111-9111-111111111111',
                    _sourceId: 'Patient/patient-1|client',
                    _sourceAssigningAuthority: 'client'
                },
                inactive: false
            },
            _uuid: '44444444-4444-5444-9444-444444444444',
            _sourceId: '44444444-4444-5444-9444-444444444444',
            _access: { client: 1 },
            _sourceAssigningAuthority: 'client'
        };

        const historyDoc = await buildHistoryDoc('GroupMember', { _id: '6530f0f0f0f0f0f0f0f0f0f2', ...input });

        expect(historyDoc.resource).toStrictEqual(input);
        expect(historyDoc.resource.groupUuid).toBe('55555555-5555-5555-9555-555555555555');
        expect(historyDoc.resource.member.entity._uuid).toBe('Patient/11111111-1111-5111-9111-111111111111');
    });

    test('an unknown top-level key is dropped', async () => {
        const historyDoc = await buildHistoryDoc('Patient', patientDoc({ notAFhirField: 'x' }));

        expect(historyDoc.resource.notAFhirField).toBeUndefined();
        expect(historyDoc.resource).toStrictEqual(patientDoc());
    });

    test('an empty array and an empty object are dropped', async () => {
        const historyDoc = await buildHistoryDoc('Patient', patientDoc({ extension: [], text: {} }));

        expect(historyDoc.resource.extension).toBeUndefined();
        expect(historyDoc.resource.text).toBeUndefined();
        expect(historyDoc.resource).toStrictEqual(patientDoc());
    });

    test.each([
        ['the type is configured', ['Patient'], 'string'],
        ['the type is not configured', [], 'undefined']
    ])('a coding without an id gets a generated id only when %s', async (_name, configuredTypes, expectedIdType) => {
        BaseSerializer.setConfigManager({ preSaveCodingIdUpdateResources: configuredTypes });
        const input = patientDoc({
            maritalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-MaritalStatus', code: 'M' }] }
        });

        const historyDoc = await buildHistoryDoc('Patient', input);

        expect(typeof historyDoc.resource.maritalStatus.coding[0].id).toBe(expectedIdType);
    });

    test('the history envelope carries the uuid and the request, without a response', async () => {
        const input = patientDoc();

        const historyDoc = await buildHistoryDoc('Patient', input);

        expect(historyDoc.id).toBe(input._uuid);
        expect(historyDoc.request).toStrictEqual({ id: 'u-1', method: 'DELETE', url: '/4_0_0/Patient/patient-1' });
        expect('response' in historyDoc).toBe(false);
    });
});
