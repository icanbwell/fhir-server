const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

const { PreSaveManager } = require('../../../preSaveHandlers/preSave');

describe('PreSaveManager', () => {
    describe('constructor', () => {
        test('stores preSaveHandlers array', () => {
            const handlers = [{ preSaveAsync: jestObj.fn() }];
            const manager = new PreSaveManager({ preSaveHandlers: handlers });

            expect(manager.preSaveHandlers).toBe(handlers);
        });

        test('stores empty array when no handlers provided', () => {
            const manager = new PreSaveManager({ preSaveHandlers: [] });

            expect(manager.preSaveHandlers).toEqual([]);
        });
    });

    describe('preSaveAsync', () => {
        test('returns resource unchanged when there are no handlers', async () => {
            const manager = new PreSaveManager({ preSaveHandlers: [] });
            const resource = { resourceType: 'Patient', id: '123' };

            const result = await manager.preSaveAsync({ resource });

            expect(result).toBe(resource);
        });

        test('calls single handler with resource and options', async () => {
            const mockHandler = {
                preSaveAsync: jestObj.fn(async ({ resource }) => resource)
            };
            const manager = new PreSaveManager({ preSaveHandlers: [mockHandler] });
            const resource = { resourceType: 'Patient', id: '123' };
            const options = { someOption: true };

            await manager.preSaveAsync({ resource, options });

            expect(mockHandler.preSaveAsync).toHaveBeenCalledWith({ resource, options });
        });

        test('chains handlers sequentially passing transformed resource to next handler', async () => {
            const handler1 = {
                preSaveAsync: jestObj.fn(async ({ resource }) => {
                    return { ...resource, transformed1: true };
                })
            };
            const handler2 = {
                preSaveAsync: jestObj.fn(async ({ resource }) => {
                    return { ...resource, transformed2: true };
                })
            };
            const manager = new PreSaveManager({ preSaveHandlers: [handler1, handler2] });
            const resource = { resourceType: 'Observation', id: '456' };
            const options = { myOpt: 'val' };

            const result = await manager.preSaveAsync({ resource, options });

            // handler1 should receive original resource
            expect(handler1.preSaveAsync).toHaveBeenCalledWith({ resource, options });

            // handler2 should receive transformed resource from handler1
            expect(handler2.preSaveAsync).toHaveBeenCalledWith({
                resource: expect.objectContaining({ transformed1: true }),
                options
            });

            // final result has both transformations
            expect(result.transformed1).toBe(true);
            expect(result.transformed2).toBe(true);
        });

        test('handles three handlers in correct order', async () => {
            const callOrder = [];
            const handler1 = {
                preSaveAsync: jestObj.fn(async ({ resource }) => {
                    callOrder.push('handler1');
                    return { ...resource, step: 1 };
                })
            };
            const handler2 = {
                preSaveAsync: jestObj.fn(async ({ resource }) => {
                    callOrder.push('handler2');
                    return { ...resource, step: 2 };
                })
            };
            const handler3 = {
                preSaveAsync: jestObj.fn(async ({ resource }) => {
                    callOrder.push('handler3');
                    return { ...resource, step: 3 };
                })
            };
            const manager = new PreSaveManager({ preSaveHandlers: [handler1, handler2, handler3] });
            const resource = { resourceType: 'Patient', id: '1' };

            const result = await manager.preSaveAsync({ resource });

            expect(callOrder).toEqual(['handler1', 'handler2', 'handler3']);
            expect(result.step).toBe(3);
        });

        test('propagates error from handler to caller', async () => {
            const errorHandler = {
                preSaveAsync: jestObj.fn(async () => {
                    throw new Error('Handler failure');
                })
            };
            const manager = new PreSaveManager({ preSaveHandlers: [errorHandler] });
            const resource = { resourceType: 'Patient', id: '1' };

            await expect(manager.preSaveAsync({ resource })).rejects.toThrow('Handler failure');
        });

        test('stops processing when a handler throws', async () => {
            const handler1 = {
                preSaveAsync: jestObj.fn(async () => {
                    throw new Error('Stop here');
                })
            };
            const handler2 = {
                preSaveAsync: jestObj.fn(async ({ resource }) => resource)
            };
            const manager = new PreSaveManager({ preSaveHandlers: [handler1, handler2] });
            const resource = { resourceType: 'Patient', id: '1' };

            await expect(manager.preSaveAsync({ resource })).rejects.toThrow('Stop here');
            expect(handler2.preSaveAsync).not.toHaveBeenCalled();
        });

        test('passes options through to all handlers', async () => {
            const handler1 = {
                preSaveAsync: jestObj.fn(async ({ resource }) => resource)
            };
            const handler2 = {
                preSaveAsync: jestObj.fn(async ({ resource }) => resource)
            };
            const manager = new PreSaveManager({ preSaveHandlers: [handler1, handler2] });
            const resource = { resourceType: 'Patient', id: '1' };
            const options = { suppressUnclassifiedTag: true, custom: 'data' };

            await manager.preSaveAsync({ resource, options });

            expect(handler1.preSaveAsync).toHaveBeenCalledWith(
                expect.objectContaining({ options })
            );
            expect(handler2.preSaveAsync).toHaveBeenCalledWith(
                expect.objectContaining({ options })
            );
        });

        test('returns the final transformed resource', async () => {
            const finalResource = { resourceType: 'Patient', id: 'final', modified: true };
            const handler = {
                preSaveAsync: jestObj.fn(async () => finalResource)
            };
            const manager = new PreSaveManager({ preSaveHandlers: [handler] });
            const resource = { resourceType: 'Patient', id: 'original' };

            const result = await manager.preSaveAsync({ resource });

            expect(result).toBe(finalResource);
        });

        test('handler can replace resource with entirely different object', async () => {
            const replacedResource = { resourceType: 'Encounter', id: 'new-resource' };
            const handler = {
                preSaveAsync: jestObj.fn(async () => replacedResource)
            };
            const manager = new PreSaveManager({ preSaveHandlers: [handler] });
            const resource = { resourceType: 'Patient', id: 'old' };

            const result = await manager.preSaveAsync({ resource });

            expect(result).toBe(replacedResource);
            expect(result.resourceType).toBe('Encounter');
        });
    });
});
