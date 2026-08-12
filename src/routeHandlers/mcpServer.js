'use strict';

const express = require('express');
const { createMcpHandler, McpServer: McpSdkServer } = require('@modelcontextprotocol/server');
const { toNodeHandler } = require('@modelcontextprotocol/node');
const { assertTypeEquals } = require('../utils/assertType');
const { McpToolHandler } = require('../mcp/mcpToolHandler');

class McpServer {
    /**
     * @param {function(): SimpleContainer} fnGetContainer
     */
    constructor (fnGetContainer) {
        this.container = fnGetContainer();
        /** @type {McpToolHandler} */
        this.mcpToolHandler = this.container.mcpToolHandler;
        assertTypeEquals(this.mcpToolHandler, McpToolHandler);

        this.handler = createMcpHandler(() => {
            const server = new McpSdkServer({ name: 'fhir-server-mcp', version: '1.0.0' });
            this.mcpToolHandler.registerTools(server);
            return server;
        });
    }

    /**
     * @returns {import('express').Router}
     */
    getRouter () {
        const router = express.Router();
        const nodeHandler = toNodeHandler(this.handler);
        router.all('/', (req, res) => { void nodeHandler(req, res, req.body); });
        return router;
    }
}

module.exports = { McpServer };
