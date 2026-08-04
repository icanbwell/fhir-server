const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const { createTestRequest } = require('../../common');

describe('#oauth callback routes (DCON-4804)', () => {
    let savedEnv;

    beforeEach(() => {
        savedEnv = {
            AUTH_CODE_FLOW_URL: process.env.AUTH_CODE_FLOW_URL,
            AUTH_CODE_FLOW_CLIENT_ID: process.env.AUTH_CODE_FLOW_CLIENT_ID,
            HOST_SERVER: process.env.HOST_SERVER
        };
        process.env.AUTH_CODE_FLOW_URL = 'https://idp.example.com';
        process.env.AUTH_CODE_FLOW_CLIENT_ID = 'my-client-id';
        process.env.HOST_SERVER = 'https://fhir.example.com';
    });

    afterEach(() => {
        process.env.AUTH_CODE_FLOW_URL = savedEnv.AUTH_CODE_FLOW_URL;
        process.env.AUTH_CODE_FLOW_CLIENT_ID = savedEnv.AUTH_CODE_FLOW_CLIENT_ID;
        process.env.HOST_SERVER = savedEnv.HOST_SERVER;
    });

    test('GET /oauth/config returns the server-computed token endpoint and client id', async () => {
        const request = await createTestRequest();
        const response = await request.get('/oauth/config');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            tokenUrl: 'https://idp.example.com/oauth2/token',
            clientId: 'my-client-id'
        });
    });

    test('GET /authcallback redirect no longer carries tokenUrl/clientId as query params', async () => {
        const request = await createTestRequest();
        const response = await request.get('/authcallback?code=abc123');
        expect(response.status).toBe(302);
        expect(response.headers.location).not.toMatch(/tokenUrl=/);
        expect(response.headers.location).not.toMatch(/clientId=/);
    });

    test('GET /authcallback percent-encodes the code param instead of interpolating it raw', async () => {
        const request = await createTestRequest();
        // '&' arrives decoded in req.query.code; the fix must re-encode it before
        // building the redirect Location so it cannot inject/override sibling params.
        const response = await request.get('/authcallback?code=abc%26injected%3Dtrue');
        expect(response.status).toBe(302);
        expect(response.headers.location).toContain('code=abc%26injected%3Dtrue');
        expect(response.headers.location).not.toContain('code=abc&injected=true');
    });

    test('GET /authcallback derives redirectUri from configured HOST_SERVER, not a spoofed Host header', async () => {
        const request = await createTestRequest();
        const response = await request
            .get('/authcallback?code=abc123')
            .set('Host', 'attacker.example.com');
        expect(response.status).toBe(302);
        expect(response.headers.location).toContain(
            encodeURIComponent('https://fhir.example.com/authcallback')
        );
        expect(response.headers.location).not.toContain('attacker.example.com');
    });

    test('GET /fhir derives redirect_uri from configured HOST_SERVER, not a spoofed Host header', async () => {
        const request = await createTestRequest();
        const response = await request
            .get('/fhir?resource=/dashboard')
            .set('Host', 'attacker.example.com');
        expect(response.status).toBe(302);
        expect(response.headers.location).toContain('redirect_uri=https://fhir.example.com/authcallback');
        expect(response.headers.location).not.toContain('attacker.example.com');
    });

    test('GET /logout_action derives logout_uri from configured HOST_SERVER, not a spoofed Host header', async () => {
        const request = await createTestRequest();
        const response = await request
            .get('/logout_action')
            .set('Host', 'attacker.example.com');
        expect(response.status).toBe(302);
        expect(response.headers.location).toContain('logout_uri=https://fhir.example.com/logout');
        expect(response.headers.location).not.toContain('attacker.example.com');
    });
});
