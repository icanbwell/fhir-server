'use strict';

const { describe, test, expect, jest: jestGlobal } = require('@jest/globals');
const { McpServer } = require('../../../routeHandlers/mcpServer');
const { McpToolHandler } = require('../../../mcp/mcpToolHandler');

function createFakeContainer () {
    const mcpToolHandler = Object.create(McpToolHandler.prototype);
    mcpToolHandler.registerTools = jestGlobal.fn();
    return { mcpToolHandler };
}

describe('McpServer route handler', () => {
    test('pulls mcpToolHandler off the container and asserts its type', () => {
        const container = createFakeContainer();
        const server = new McpServer(() => container);
        expect(server.mcpToolHandler).toBe(container.mcpToolHandler);
    });

    test('throws if the container does not provide a valid mcpToolHandler', () => {
        expect(() => new McpServer(() => ({ mcpToolHandler: {} }))).toThrow();
    });

    test('getRouter returns an express Router handling POST /', () => {
        const container = createFakeContainer();
        const server = new McpServer(() => container);

        const router = server.getRouter();

        expect(typeof router).toBe('function');
        expect(router.stack.some((layer) => layer.route && layer.route.path === '/')).toBe(true);
    });

    test('registerTools is invoked exactly once per constructed McpServer instance via the handler factory', async () => {
        const container = createFakeContainer();
        const server = new McpServer(() => container);

        // The SDK factory runs lazily per request; force one invocation the same way createMcpHandler
        // would, by driving the underlying web-standard handler with a tools/list call.
        await server.handler.fetch(new Request('http://localhost/mcp', {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
        }));

        expect(container.mcpToolHandler.registerTools).toHaveBeenCalledTimes(1);
    });
});
