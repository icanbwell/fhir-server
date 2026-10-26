'use strict';

/**
 * DCON-6113: RemoveHelper writes DELETE history through FastDatabaseBulkInserter when
 * ENABLE_REMOVE_FAST_SERIALIZER is on. These tests pin that both inserters build the same history
 * document from the inputs RemoveHelper hands them -- the legacy one from the caller's resource
 * as-is, the fast one from the plain snapshot RemoveHelper takes -- and the cases where they
 * differ on purpose.
 */

const { describe, test, beforeEach, afterEach, expect, jest } = require('@jest/globals');
const deepcopy = require('deepcopy');
const { DatabaseBulkInserter } = require('../../../dataLayer/databaseBulkInserter');
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
const Resource = require('../../../fhir/classes/4_0_0/resources/resource');
const Patient = require('../../../fhir/classes/4_0_0/resources/patient');

const BASE_VERSION = '4_0_0';
const REQUEST_ID = 'parity-request';

/**
 * Same rule RemoveHelper uses for the fast path.
 * @param {Resource|Object} resource
 * @returns {Object}
 */
function toRemoveHistorySnapshot(resource) {
    return resource instanceof Resource ? resource.toJSONInternal() : deepcopy(resource);
}

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

/**
 * Queues `input` on both inserters the way RemoveHelper does and returns the two queued history
 * documents.
 * @param {string} resourceType
 * @param {Resource|Object} input
 * @returns {Promise<{legacyDoc: Object, fastDoc: Object}>}
 */
async function buildBothHistoryDocs(resourceType, input) {
    const legacyInserter = new DatabaseBulkInserter(createDeps());
    const fastInserter = new FastDatabaseBulkInserter(createDeps());
    const requestInfo = createRequestInfo();

    await legacyInserter.insertOneHistoryAsync({
        requestInfo,
        base_version: BASE_VERSION,
        resourceType,
        doc: input,
        skipResourceAssertion: true
    });
    await fastInserter.insertOneHistoryAsync({
        requestInfo,
        base_version: BASE_VERSION,
        resourceType,
        doc: toRemoveHistorySnapshot(input)
    });

    const queuedDocument = (inserter) =>
        inserter.getHistoryOperationsByResourceTypeMap({ requestId: REQUEST_ID })
            .get(resourceType)[0].operation.insertOne.document;

    return { legacyDoc: queuedDocument(legacyInserter), fastDoc: queuedDocument(fastInserter) };
}

function patientDoc(overrides = {}) {
    return {
        resourceType: 'Patient',
        id: 'patient-1',
        meta: {
            versionId: '3',
            lastUpdated: new Date('2026-10-26T10:00:00.000Z'),
            source: 'http://example.com/source',
            security: [
                { system: 'https://www.icanbwell.com/owner', code: 'client' },
                { system: 'https://www.icanbwell.com/access', code: 'client' },
                { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'client' }
            ]
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

describe('DELETE history document parity: DatabaseBulkInserter vs FastDatabaseBulkInserter', () => {
    let previousSerializerConfig;

    beforeEach(() => {
        previousSerializerConfig = BaseSerializer.configManager;
        BaseSerializer.setConfigManager({ preSaveCodingIdUpdateResources: [] });
    });

    afterEach(() => {
        BaseSerializer.setConfigManager(previousSerializerConfig);
    });

    test('Patient Resource instance with meta.security, identifier and internal fields', async () => {
        const { legacyDoc, fastDoc } = await buildBothHistoryDocs('Patient', new Patient(patientDoc()));

        expect(fastDoc).toStrictEqual(legacyDoc);
        expect(fastDoc.resource._uuid).toBe('11111111-1111-5111-9111-111111111111');
        expect(fastDoc.resource._sourceId).toBe('patient-1');
        expect(fastDoc.resource._access).toStrictEqual({ client: 1 });
        expect(fastDoc.resource._sourceAssigningAuthority).toBe('client');
    });

    test('plain Patient doc with Mongo _id', async () => {
        const { legacyDoc, fastDoc } = await buildBothHistoryDocs(
            'Patient',
            patientDoc({ _id: '6530f0f0f0f0f0f0f0f0f0f0' })
        );

        expect(fastDoc).toStrictEqual(legacyDoc);
        expect(legacyDoc.resource._id).toBeUndefined();
        expect(fastDoc.resource._id).toBeUndefined();
    });

    test('meta.lastUpdated is a Date', async () => {
        const lastUpdated = new Date('2026-10-26T12:34:56.789Z');
        const input = patientDoc();
        input.meta.lastUpdated = lastUpdated;

        const { legacyDoc, fastDoc } = await buildBothHistoryDocs('Patient', input);

        expect(fastDoc.resource.meta.lastUpdated).toBeInstanceOf(Date);
        expect(fastDoc.resource.meta.lastUpdated).toStrictEqual(legacyDoc.resource.meta.lastUpdated);
        expect(fastDoc.resource.meta.lastUpdated.getTime()).toBe(lastUpdated.getTime());
    });

    test('Binary with _blobMeta and no data', async () => {
        const input = {
            resourceType: 'Binary',
            id: 'binary-1',
            meta: { versionId: '1', lastUpdated: new Date('2026-10-26T10:00:00.000Z'), security: patientDoc().meta.security },
            contentType: 'application/pdf',
            _blobMeta: { hash: 'abc123', rawSize: 2048, lastUpdated: '2026-10-26T10:00:00.000Z' },
            _uuid: '22222222-2222-5222-9222-222222222222',
            _sourceId: 'binary-1',
            _access: { client: 1 },
            _sourceAssigningAuthority: 'client'
        };

        const { legacyDoc, fastDoc } = await buildBothHistoryDocs('Binary', input);

        expect(fastDoc).toStrictEqual(legacyDoc);
        expect(fastDoc.resource._blobMeta).toStrictEqual(input._blobMeta);
        expect(fastDoc.resource.data).toBeUndefined();
    });

    test('DocumentReference attachment with _file_id', async () => {
        const input = {
            resourceType: 'DocumentReference',
            id: 'docref-1',
            meta: { versionId: '1', lastUpdated: new Date('2026-10-26T10:00:00.000Z'), security: patientDoc().meta.security },
            status: 'current',
            content: [{ attachment: { contentType: 'application/pdf', _file_id: '6530f0f0f0f0f0f0f0f0f0f1' } }],
            _uuid: '33333333-3333-5333-9333-333333333333',
            _sourceId: 'docref-1',
            _access: { client: 1 },
            _sourceAssigningAuthority: 'client'
        };

        const { legacyDoc, fastDoc } = await buildBothHistoryDocs('DocumentReference', input);

        expect(fastDoc).toStrictEqual(legacyDoc);
        expect(fastDoc.resource.content[0].attachment._file_id).toBe('6530f0f0f0f0f0f0f0f0f0f1');
    });

    test('GroupMember raw row', async () => {
        const input = {
            _id: '6530f0f0f0f0f0f0f0f0f0f2',
            resourceType: 'GroupMember',
            id: '44444444-4444-5444-9444-444444444444',
            meta: { versionId: '2', lastUpdated: new Date('2026-10-26T10:00:00.000Z'), security: patientDoc().meta.security },
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

        const { legacyDoc, fastDoc } = await buildBothHistoryDocs('GroupMember', input);

        expect(fastDoc).toStrictEqual(legacyDoc);
        expect(fastDoc.resource.groupUuid).toBe('55555555-5555-5555-9555-555555555555');
        expect(fastDoc.resource.member.entity._uuid).toBe('Patient/11111111-1111-5111-9111-111111111111');
    });

    test('plain doc with an unknown top-level key', async () => {
        const { legacyDoc, fastDoc } = await buildBothHistoryDocs(
            'Patient',
            patientDoc({ notAFhirField: 'x' })
        );

        expect(fastDoc).toStrictEqual(legacyDoc);
        expect(fastDoc.resource.notAFhirField).toBeUndefined();
    });

    test('plain doc with empty array and empty object: both drop the array, only legacy keeps the object', async () => {
        // The legacy class setters already turn [] into undefined; an empty complex type such as
        // text: {} survives as {} through Narrative.toJSONInternal(), while the write serializer
        // drops it.
        const input = patientDoc({ identifier: [], text: {} });

        const { legacyDoc, fastDoc } = await buildBothHistoryDocs('Patient', input);

        expect(legacyDoc.resource.identifier).toBeUndefined();
        expect(fastDoc.resource.identifier).toBeUndefined();
        expect(legacyDoc.resource.text).toStrictEqual({});
        expect(fastDoc.resource.text).toBeUndefined();

        const withoutEmpties = (doc) => {
            const copy = deepcopy(doc);
            delete copy.resource.identifier;
            delete copy.resource.text;
            return copy;
        };
        expect(withoutEmpties(fastDoc)).toStrictEqual(withoutEmpties(legacyDoc));
    });

    test('coding without id gets a generated id on the fast path only when its type is configured', async () => {
        BaseSerializer.setConfigManager({ preSaveCodingIdUpdateResources: ['Patient'] });
        const input = patientDoc({
            maritalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-MaritalStatus', code: 'M' }] }
        });

        const { legacyDoc, fastDoc } = await buildBothHistoryDocs('Patient', input);

        expect(legacyDoc.resource.maritalStatus.coding[0].id).toBeUndefined();
        expect(typeof fastDoc.resource.maritalStatus.coding[0].id).toBe('string');
    });

    test('input is not mutated', async () => {
        const plainInput = patientDoc({ _id: '6530f0f0f0f0f0f0f0f0f0f0', identifier: [], notAFhirField: 'x' });
        const plainBefore = deepcopy(plainInput);
        const instanceInput = new Patient(patientDoc());
        const instanceBefore = deepcopy(instanceInput.toJSONInternal());

        await buildBothHistoryDocs('Patient', plainInput);
        await buildBothHistoryDocs('Patient', instanceInput);

        expect(plainInput).toStrictEqual(plainBefore);
        expect(instanceInput.toJSONInternal()).toStrictEqual(instanceBefore);
    });

    test('history envelope', async () => {
        const input = patientDoc();

        const { fastDoc } = await buildBothHistoryDocs('Patient', input);

        expect(fastDoc.id).toBe(input._uuid);
        expect(fastDoc.request).toStrictEqual({ id: 'u-1', method: 'DELETE', url: '/4_0_0/Patient/patient-1' });
        expect('response' in fastDoc).toBe(false);
    });
});
