'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const { BundleMetaApolloServerPlugin, getBundleMetaApolloServerPlugin } = require('../../../../middleware/graphql/plugins/graphqlBundleMetaPlugin');

describe('BundleMetaApolloServerPlugin', () => {
    const makeMeta = () => ({ tag: [{ system: 'https://www.icanbwell.com/queryTime', code: '50ms' }] });

    const makeRequestContext = (overrides = {}) => ({
        contextValue: {
            dataApi: {
                getBundleMeta: jestObj.fn(() => makeMeta())
            }
        },
        response: {
            body: {
                kind: 'single',
                singleResult: {
                    data: {
                        patient: { resourceType: 'Bundle', entry: [] }
                    }
                }
            }
        },
        ...overrides
    });

    test('getBundleMetaApolloServerPlugin returns plugin instance', () => {
        const plugin = getBundleMetaApolloServerPlugin();
        expect(plugin).toBeInstanceOf(BundleMetaApolloServerPlugin);
    });

    test('requestDidStart returns object with willSendResponse', async () => {
        const plugin = new BundleMetaApolloServerPlugin();
        const hooks = await plugin.requestDidStart({});
        expect(hooks.willSendResponse).toBeDefined();
        expect(typeof hooks.willSendResponse).toBe('function');
    });

    test('willSendResponse adds meta to bundle data', async () => {
        const plugin = new BundleMetaApolloServerPlugin();
        const hooks = await plugin.requestDidStart({});
        const ctx = makeRequestContext();

        hooks.willSendResponse(ctx);

        const data = ctx.response.body.singleResult.data;
        expect(data.patient.meta).toEqual(makeMeta());
    });

    test('willSendResponse does nothing when response is null', async () => {
        const plugin = new BundleMetaApolloServerPlugin();
        const hooks = await plugin.requestDidStart({});
        const ctx = makeRequestContext({ response: null });

        expect(() => hooks.willSendResponse(ctx)).not.toThrow();
    });

    test('willSendResponse does nothing when data is null', async () => {
        const plugin = new BundleMetaApolloServerPlugin();
        const hooks = await plugin.requestDidStart({});
        const ctx = makeRequestContext();
        ctx.response.body.singleResult.data = null;

        expect(() => hooks.willSendResponse(ctx)).not.toThrow();
    });

    test('willSendResponse does nothing when dataApi is null', async () => {
        const plugin = new BundleMetaApolloServerPlugin();
        const hooks = await plugin.requestDidStart({});
        const ctx = makeRequestContext();
        ctx.contextValue.dataApi = null;

        expect(() => hooks.willSendResponse(ctx)).not.toThrow();
    });

    test('willSendResponse does nothing for non-single response kind', async () => {
        const plugin = new BundleMetaApolloServerPlugin();
        const hooks = await plugin.requestDidStart({});
        const ctx = makeRequestContext();
        ctx.response.body.kind = 'incremental';

        hooks.willSendResponse(ctx);
        expect(ctx.contextValue.dataApi.getBundleMeta).not.toHaveBeenCalled();
    });

    test('willSendResponse handles multiple bundles in data', async () => {
        const plugin = new BundleMetaApolloServerPlugin();
        const hooks = await plugin.requestDidStart({});
        const ctx = makeRequestContext();
        ctx.response.body.singleResult.data = {
            patient: { resourceType: 'Bundle', entry: [] },
            observation: { resourceType: 'Bundle', entry: [] }
        };

        hooks.willSendResponse(ctx);
        expect(ctx.response.body.singleResult.data.patient.meta).toBeDefined();
        expect(ctx.response.body.singleResult.data.observation.meta).toBeDefined();
    });

    test('willSendResponse skips null bundle values in data', async () => {
        const plugin = new BundleMetaApolloServerPlugin();
        const hooks = await plugin.requestDidStart({});
        const ctx = makeRequestContext();
        ctx.response.body.singleResult.data = {
            patient: null,
            observation: { resourceType: 'Bundle', entry: [] }
        };

        expect(() => hooks.willSendResponse(ctx)).not.toThrow();
        expect(ctx.response.body.singleResult.data.observation.meta).toBeDefined();
    });
});
