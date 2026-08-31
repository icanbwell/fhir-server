'use strict';

// Proves the ENABLE_MCP kill switch actually gates the /mcp route AND prevents McpServer's
// constructor from ever running (not just prevents the route from being reachable). McpServer's
// constructor does eager, boot-time work (assertTypeEquals(this.mcpToolHandler, McpToolHandler))
// that could break the entire app's boot if ever mis-wired, so this test wraps the real class in a
// jest.fn spy to confirm it is never invoked when the flag is off.
const { describe, test, expect, afterEach, jest: jestGlobal } = require('@jest/globals');
const supertest = require('supertest');

const actualMcpServerModule = jestGlobal.requireActual('../../../routeHandlers/mcpServer');
const mcpServerConstructorSpy = jestGlobal.fn().mockImplementation(
    (...args) => new actualMcpServerModule.McpServer(...args)
);

jestGlobal.mock('../../../routeHandlers/mcpServer', () => ({
    McpServer: function (...args) {
        return mcpServerConstructorSpy(...args);
    }
}));

const { createTestApp } = require('../common');

describe('ENABLE_MCP feature flag', () => {
    const originalEnableMcp = process.env.ENABLE_MCP;

    afterEach(() => {
        process.env.ENABLE_MCP = originalEnableMcp;
        mcpServerConstructorSpy.mockClear();
    });

    test('mounts /mcp and constructs McpServer when ENABLE_MCP is enabled', async () => {
        process.env.ENABLE_MCP = '1';

        const app = await createTestApp();

        expect(mcpServerConstructorSpy).toHaveBeenCalledTimes(1);

        // GET (not POST) so the request never reaches the generic FHIR catch-all's content-type
        // validation, which would otherwise short-circuit with a 400 before routing decides
        // whether /mcp itself is mounted, masking what this test wants to prove.
        const response = await supertest(app).get('/mcp');
        // Reaches the mcp auth middleware chain and is rejected as unauthenticated (401), not a
        // route-not-found (404) -- proving the route is actually mounted.
        expect(response.status).toBe(401);
    });

    test('does not mount /mcp and never constructs McpServer when ENABLE_MCP is disabled', async () => {
        process.env.ENABLE_MCP = '0';

        const app = await createTestApp();

        // The whole point of the flag: McpServer's constructor (which does
        // assertTypeEquals(this.mcpToolHandler, McpToolHandler)) must never run, so a mis-wired
        // mcpToolHandler can never break app boot when MCP is disabled.
        expect(mcpServerConstructorSpy).not.toHaveBeenCalled();

        const response = await supertest(app).get('/mcp');
        expect(response.status).toBe(404);
    });

    test('does not mount /mcp when ENABLE_MCP is unset', async () => {
        delete process.env.ENABLE_MCP;

        const app = await createTestApp();

        expect(mcpServerConstructorSpy).not.toHaveBeenCalled();

        const response = await supertest(app).get('/mcp');
        expect(response.status).toBe(404);
    });
});
