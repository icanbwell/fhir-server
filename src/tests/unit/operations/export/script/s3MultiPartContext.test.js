'use strict';

const { describe, test, expect } = require('@jest/globals');
const { S3MultiPartContext } = require('../../../../../operations/export/script/s3MultiPartContext');

describe('S3MultiPartContext', () => {
    test('stores all properties', () => {
        const ctx = new S3MultiPartContext({
            uploadId: 'upload-123',
            readCount: 500,
            resourceFilePath: 's3://bucket/Patient.ndjson',
            collection: 'Patient_4_0_0',
            previousBuffer: ['line1', 'line2'],
            previousBatchSize: 100,
            averageDocumentSize: 2048,
            multipartUploadParts: [{ PartNumber: 1, ETag: 'abc' }]
        });
        expect(ctx.uploadId).toBe('upload-123');
        expect(ctx.readCount).toBe(500);
        expect(ctx.resourceFilePath).toBe('s3://bucket/Patient.ndjson');
        expect(ctx.collection).toBe('Patient_4_0_0');
        expect(ctx.previousBuffer).toEqual(['line1', 'line2']);
        expect(ctx.previousBatchSize).toBe(100);
        expect(ctx.averageDocumentSize).toBe(2048);
        expect(ctx.multipartUploadParts).toEqual([{ PartNumber: 1, ETag: 'abc' }]);
    });

    test('readCount defaults to 0 when falsy', () => {
        const ctx = new S3MultiPartContext({
            uploadId: null,
            readCount: 0,
            resourceFilePath: null,
            collection: null,
            previousBuffer: null,
            previousBatchSize: null,
            averageDocumentSize: null,
            multipartUploadParts: null
        });
        expect(ctx.readCount).toBe(0);
    });

    test('readCount defaults to 0 when undefined', () => {
        const ctx = new S3MultiPartContext({
            uploadId: null,
            resourceFilePath: null,
            collection: null,
            previousBuffer: null,
            previousBatchSize: null,
            averageDocumentSize: null,
            multipartUploadParts: null
        });
        expect(ctx.readCount).toBe(0);
    });

    test('multipartUploadParts defaults to empty array when falsy', () => {
        const ctx = new S3MultiPartContext({
            uploadId: null,
            readCount: 10,
            resourceFilePath: null,
            collection: null,
            previousBuffer: null,
            previousBatchSize: null,
            averageDocumentSize: null,
            multipartUploadParts: null
        });
        expect(ctx.multipartUploadParts).toEqual([]);
    });

    test('multipartUploadParts defaults to empty array when undefined', () => {
        const ctx = new S3MultiPartContext({
            uploadId: 'x',
            readCount: 1,
            resourceFilePath: 'path',
            collection: 'col',
            previousBuffer: [],
            previousBatchSize: 0,
            averageDocumentSize: 0
        });
        expect(ctx.multipartUploadParts).toEqual([]);
    });

    test('null values pass through for nullable fields', () => {
        const ctx = new S3MultiPartContext({
            uploadId: null,
            readCount: 5,
            resourceFilePath: null,
            collection: null,
            previousBuffer: null,
            previousBatchSize: null,
            averageDocumentSize: null,
            multipartUploadParts: []
        });
        expect(ctx.uploadId).toBeNull();
        expect(ctx.resourceFilePath).toBeNull();
        expect(ctx.collection).toBeNull();
        expect(ctx.previousBuffer).toBeNull();
        expect(ctx.previousBatchSize).toBeNull();
        expect(ctx.averageDocumentSize).toBeNull();
    });
});
