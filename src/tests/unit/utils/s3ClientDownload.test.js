const { describe, test, expect, beforeEach, afterEach, jest } = require('@jest/globals');
const { NoSuchKey } = require('@aws-sdk/client-s3');

jest.mock('../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logWarn: jest.fn(),
    logInfo: jest.fn(),
    logDebug: jest.fn()
}));

const { S3Client } = require('../../../utils/s3Client');

const okResponse = (text) => ({ Body: { transformToString: async () => text } });
const failingBody = (err) => ({
    Body: {
        transformToString: async () => {
            throw err;
        }
    }
});

describe('S3Client.downloadAsync retry', () => {
    let s3;
    let send;

    beforeEach(() => {
        s3 = new S3Client({ bucketName: 'bucket', region: 'us-east-1' });
        send = jest.fn();
        s3.client = { send };
        jest.spyOn(global, 'setTimeout').mockImplementation((fn) => {
            fn();
            return 0;
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('returns content on first try', async () => {
        send.mockResolvedValueOnce(okResponse('abc'));
        expect(await s3.downloadAsync('k')).toBe('abc');
        expect(send).toHaveBeenCalledTimes(1);
    });

    test('retries transient body-read abort then succeeds', async () => {
        send.mockResolvedValueOnce(failingBody(new Error('aborted'))).mockResolvedValueOnce(okResponse('abc'));
        expect(await s3.downloadAsync('k')).toBe('abc');
        expect(send).toHaveBeenCalledTimes(2);
    });

    test('retries 5xx from send then succeeds', async () => {
        const err = Object.assign(new Error('boom'), { $metadata: { httpStatusCode: 503 } });
        send.mockRejectedValueOnce(err).mockResolvedValueOnce(okResponse('abc'));
        expect(await s3.downloadAsync('k')).toBe('abc');
        expect(send).toHaveBeenCalledTimes(2);
    });

    test('throws after 3 attempts when transient error persists', async () => {
        send.mockImplementation(async () => failingBody(Object.assign(new Error('read failed'), { code: 'ECONNRESET' })));
        await expect(s3.downloadAsync('k')).rejects.toThrow(/Error in downloadAsync: read failed/);
        expect(send).toHaveBeenCalledTimes(3);
    });

    test('NoSuchKey returns null without retry', async () => {
        send.mockRejectedValue(new NoSuchKey({ message: 'nope', $metadata: {} }));
        expect(await s3.downloadAsync('k')).toBeNull();
        expect(send).toHaveBeenCalledTimes(1);
    });

    test('non-transient error fails immediately', async () => {
        const err = Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
        send.mockRejectedValue(err);
        await expect(s3.downloadAsync('k')).rejects.toThrow(/Error in downloadAsync: denied/);
        expect(send).toHaveBeenCalledTimes(1);
    });
});
