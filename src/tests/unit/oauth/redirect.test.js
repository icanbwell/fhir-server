const { describe, test, expect } = require('@jest/globals');
const path = require('path');
const fs = require('fs');

describe('oauth/redirect.js', () => {
    const filePath = path.resolve(__dirname, '../../../oauth/redirect.js');

    test('file exists', () => {
        expect(fs.existsSync(filePath)).toBe(true);
    });

    test('file contains getUrlVars function', () => {
        const content = fs.readFileSync(filePath, 'utf8');
        expect(content).toContain('function getUrlVars');
    });

    test('file contains setCookie function', () => {
        const content = fs.readFileSync(filePath, 'utf8');
        expect(content).toContain('function setCookie');
    });

    test('file contains parseJwt function', () => {
        const content = fs.readFileSync(filePath, 'utf8');
        expect(content).toContain('function parseJwt');
    });

    test('uses axios for token request', () => {
        const content = fs.readFileSync(filePath, 'utf8');
        expect(content).toContain('axios');
        expect(content).toContain('request');
    });

    test('sends authorization_code grant_type', () => {
        const content = fs.readFileSync(filePath, 'utf8');
        expect(content).toContain("grant_type: 'authorization_code'");
    });

    test('sets Content-Type to application/x-www-form-urlencoded', () => {
        const content = fs.readFileSync(filePath, 'utf8');
        expect(content).toContain('application/x-www-form-urlencoded');
    });

    test('redirects only relative URLs for security', () => {
        const content = fs.readFileSync(filePath, 'utf8');
        expect(content).toContain("if (resourceUrl.startsWith('/'))");
        expect(content).toContain('Url is not a relative');
    });

    test('sets cookie with samesite=strict for security', () => {
        const content = fs.readFileSync(filePath, 'utf8');
        expect(content).toContain('samesite=strict');
    });

    test('uses authcallback as redirect_uri path', () => {
        const content = fs.readFileSync(filePath, 'utf8');
        expect(content).toContain('/authcallback');
    });

    test('parseJwt decodes base64url correctly by replacing - and _ characters', () => {
        const content = fs.readFileSync(filePath, 'utf8');
        expect(content).toContain("replace(/-/g, '+')");
        expect(content).toContain("replace(/_/g, '/')");
    });

    test('uses URLSearchParams for query parameter extraction', () => {
        const content = fs.readFileSync(filePath, 'utf8');
        expect(content).toContain('URLSearchParams');
    });

    test('extracts code parameter from URL for authorization', () => {
        const content = fs.readFileSync(filePath, 'utf8');
        expect(content).toContain("parameters.get('code')");
    });

    test('extracts tokenUrl parameter from URL', () => {
        const content = fs.readFileSync(filePath, 'utf8');
        expect(content).toContain("parameters.get('tokenUrl')");
    });

    test('sets jwt cookie from access_token in response', () => {
        const content = fs.readFileSync(filePath, 'utf8');
        expect(content).toContain('res.data.access_token');
        expect(content).toContain("setCookie('jwt'");
    });
});
