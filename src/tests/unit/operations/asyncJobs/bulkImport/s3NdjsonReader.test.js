'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock AWS SDK and dependencies
jestObj.mock('@aws-sdk/client-s3', () => ({
    S3Client: jestObj.fn().mockImplementation(() => ({
        send: jestObj.fn()
    })),
    GetObjectCommand: jestObj.fn()
}));

jestObj.mock('../../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn()
}));

jestObj.mock('../../../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logError: jestObj.fn()
}));

const { S3NdjsonReader } = require('../../../../../operations/asyncJobs/bulkImport/s3NdjsonReader');

describe('S3NdjsonReader', () => {
    let reader;
    let mockConfigManager;

    beforeEach(() => {
        mockConfigManager = {
            bulkImportAllowedS3Buckets: ['allowed-bucket', 'another-allowed'],
            awsRegion: 'us-east-1',
            bulkImportMaxLineSizeMb: 10
        };
        reader = new S3NdjsonReader({ configManager: mockConfigManager });
    });

    describe('parseS3Uri', () => {
        test('parses valid S3 URI', () => {
            const result = reader.parseS3Uri('s3://my-bucket/path/to/file.ndjson');
            expect(result).toEqual({ bucket: 'my-bucket', key: 'path/to/file.ndjson' });
        });

        test('parses S3 URI with complex key', () => {
            const result = reader.parseS3Uri('s3://bucket/a/b/c/d.json');
            expect(result).toEqual({ bucket: 'bucket', key: 'a/b/c/d.json' });
        });

        test('throws for invalid S3 URI format', () => {
            expect(() => reader.parseS3Uri('https://bucket/key')).toThrow(/Invalid S3 URI/);
            expect(() => reader.parseS3Uri('/local/path')).toThrow(/Invalid S3 URI/);
            expect(() => reader.parseS3Uri('')).toThrow(/Invalid S3 URI/);
            expect(() => reader.parseS3Uri('s3://')).toThrow(/Invalid S3 URI/);
        });

        test('throws for S3 URI without key', () => {
            expect(() => reader.parseS3Uri('s3://bucket-only/')).toThrow(/Invalid S3 URI/);
        });
    });

    describe('readNdjsonAsync parameter validation', () => {
        test('throws for invalid fileSize', async () => {
            const gen = reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: 100,
                fileSize: 0
            });
            await expect(gen.next()).rejects.toThrow(/Invalid fileSize/);
        });

        test('throws for negative fileSize', async () => {
            const gen = reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: 100,
                fileSize: -1
            });
            await expect(gen.next()).rejects.toThrow(/Invalid fileSize/);
        });

        test('throws for NaN fileSize', async () => {
            const gen = reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: 100,
                fileSize: NaN
            });
            await expect(gen.next()).rejects.toThrow(/Invalid fileSize/);
        });

        test('throws for negative byteRangeStart', async () => {
            const gen = reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: -1,
                byteRangeEnd: 100,
                fileSize: 1000
            });
            await expect(gen.next()).rejects.toThrow(/Invalid byteRangeStart/);
        });

        test('throws for byteRangeEnd <= byteRangeStart', async () => {
            const gen = reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/file.ndjson',
                byteRangeStart: 100,
                byteRangeEnd: 100,
                fileSize: 1000
            });
            await expect(gen.next()).rejects.toThrow(/Invalid byteRangeEnd/);
        });

        test('throws for disallowed S3 bucket (SSRF protection)', async () => {
            const gen = reader.readNdjsonAsync({
                filepath: 's3://evil-bucket/data.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: 100,
                fileSize: 1000
            });
            await expect(gen.next()).rejects.toThrow(/not in the allowed list/);
        });

        test('throws when bucket allowlist is empty', async () => {
            mockConfigManager.bulkImportAllowedS3Buckets = [];
            const gen = reader.readNdjsonAsync({
                filepath: 's3://allowed-bucket/data.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: 100,
                fileSize: 1000
            });
            await expect(gen.next()).rejects.toThrow(/allowlist is not configured/);
        });

        test('bucket validation is case-sensitive', async () => {
            const gen = reader.readNdjsonAsync({
                filepath: 's3://Allowed-Bucket/data.ndjson',
                byteRangeStart: 0,
                byteRangeEnd: 100,
                fileSize: 1000
            });
            await expect(gen.next()).rejects.toThrow(/not in the allowed list/);
        });
    });
});
