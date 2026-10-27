const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

const mockPresign = jestObj.fn();
jestObj.mock('@smithy/signature-v4', () => ({
    SignatureV4: jestObj.fn().mockImplementation(() => ({ presign: mockPresign }))
}));
jestObj.mock('@aws-sdk/credential-provider-node', () => ({
    defaultProvider: jestObj.fn()
}));

const {
    getValkeyConfig,
    generateValkeyIamToken,
    valkeyCredentialsProvider
} = require('../../../utils/valkeyIam');

const HOST = 'dev-use1-cache-fhir-server-fi04rw.serverless.use1.cache.amazonaws.com';
const USER = 'dev-use1-fhir-server-app';

describe('valkeyIam', () => {
    beforeEach(() => {
        mockPresign.mockReset();
    });

    describe('getValkeyConfig', () => {
        test('is disabled when VALKEY_HOST is not set', () => {
            expect(getValkeyConfig({})).toBeUndefined();
        });

        test('reads host, port, user and region when VALKEY_HOST is set', () => {
            expect(getValkeyConfig({ VALKEY_HOST: HOST, VALKEY_IAM_USERNAME: USER })).toEqual({
                host: HOST,
                port: 6379,
                username: USER,
                region: 'us-east-1'
            });
        });

        test('requires VALKEY_IAM_USERNAME when VALKEY_HOST is set', () => {
            expect(() => getValkeyConfig({ VALKEY_HOST: HOST })).toThrow(/VALKEY_IAM_USERNAME/);
        });
    });

    describe('generateValkeyIamToken', () => {
        test('signs for the serverless cache name with ResourceType=ServerlessCache', async () => {
            mockPresign.mockResolvedValue({ query: { 'X-Amz-Signature': 'abc' } });

            const token = await generateValkeyIamToken({
                host: HOST,
                username: USER,
                region: 'us-east-1'
            });

            const request = mockPresign.mock.calls[0][0];
            expect(request.hostname).toBe('dev-use1-cache-fhir-server');
            expect(request.query).toEqual({
                Action: 'connect',
                User: USER,
                ResourceType: 'ServerlessCache'
            });
            expect(mockPresign.mock.calls[0][1]).toEqual({ expiresIn: 900 });
            expect(token).toBe('dev-use1-cache-fhir-server/?X-Amz-Signature=abc');
        });

        test('signs for the host as given when it is not a serverless endpoint', async () => {
            mockPresign.mockResolvedValue({ query: {} });

            await generateValkeyIamToken({ host: 'cache.example.com', username: 'u', region: 'us-east-1' });

            const request = mockPresign.mock.calls[0][0];
            expect(request.hostname).toBe('cache.example.com');
            expect(request.query).toEqual({ Action: 'connect', User: 'u' });
        });
    });

    test('credentials provider signs a fresh token on every lookup', async () => {
        mockPresign
            .mockResolvedValueOnce({ query: { 'X-Amz-Signature': 'one' } })
            .mockResolvedValueOnce({ query: { 'X-Amz-Signature': 'two' } });
        const provider = valkeyCredentialsProvider({ host: HOST, username: USER, region: 'us-east-1' });

        const first = await provider.credentials();
        const second = await provider.credentials();

        expect(provider.type).toBe('async-credentials-provider');
        expect(first.username).toBe(USER);
        expect(first.password).toContain('X-Amz-Signature=one');
        expect(second.password).toContain('X-Amz-Signature=two');
    });
});
