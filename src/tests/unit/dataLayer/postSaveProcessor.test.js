'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../utils/basePostSaveHandler', () => ({
    BasePostSaveHandler: class BasePostSaveHandler {}
}));

const { PostSaveProcessor } = require('../../../dataLayer/postSaveProcessor');

describe('PostSaveProcessor', () => {
    let handler1;
    let handler2;

    beforeEach(() => {
        handler1 = {
            afterSaveAsync: jestObj.fn().mockResolvedValue(undefined),
            flushAsync: jestObj.fn().mockResolvedValue(undefined),
            shouldBlockForResource: jestObj.fn().mockReturnValue(false)
        };
        handler2 = {
            afterSaveAsync: jestObj.fn().mockResolvedValue(undefined),
            flushAsync: jestObj.fn().mockResolvedValue(undefined),
            shouldBlockForResource: jestObj.fn().mockReturnValue(false)
        };
    });

    test('constructor stores handlers', () => {
        const processor = new PostSaveProcessor({ handlers: [handler1, handler2] });
        expect(processor.handlers).toHaveLength(2);
    });

    describe('needsSyncFor', () => {
        test('returns false when no handlers block', () => {
            const processor = new PostSaveProcessor({ handlers: [handler1, handler2] });
            expect(processor.needsSyncFor({ resourceType: 'Patient' })).toBe(false);
        });

        test('returns true when any handler blocks for resource type', () => {
            handler2.shouldBlockForResource.mockReturnValue(true);
            const processor = new PostSaveProcessor({ handlers: [handler1, handler2] });
            expect(processor.needsSyncFor({ resourceType: 'Group' })).toBe(true);
        });

        test('returns false when handler has no shouldBlockForResource method', () => {
            delete handler1.shouldBlockForResource;
            const processor = new PostSaveProcessor({ handlers: [handler1] });
            expect(processor.needsSyncFor({ resourceType: 'Patient' })).toBe(false);
        });
    });

    describe('afterSaveAsync', () => {
        test('calls all handlers with correct params', async () => {
            const processor = new PostSaveProcessor({ handlers: [handler1, handler2] });
            const params = {
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Patient',
                doc: { id: '123' }
            };
            await processor.afterSaveAsync(params);
            expect(handler1.afterSaveAsync).toHaveBeenCalledWith(expect.objectContaining(params));
            expect(handler2.afterSaveAsync).toHaveBeenCalledWith(expect.objectContaining(params));
        });

        test('wraps handler errors in RethrownError', async () => {
            handler1.afterSaveAsync.mockRejectedValue(new Error('handler failed'));
            const processor = new PostSaveProcessor({ handlers: [handler1] });
            await expect(processor.afterSaveAsync({
                requestId: 'r1', eventType: 'U', resourceType: 'Patient', doc: {}
            })).rejects.toThrow('Error in afterSaveAsync()');
        });

        test('contextData defaults to null', async () => {
            const processor = new PostSaveProcessor({ handlers: [handler1] });
            await processor.afterSaveAsync({
                requestId: 'r1', eventType: 'C', resourceType: 'Obs', doc: {}
            });
            expect(handler1.afterSaveAsync).toHaveBeenCalledWith(
                expect.objectContaining({ contextData: null })
            );
        });
    });

    describe('flushAsync', () => {
        test('calls flushAsync on all handlers', async () => {
            const processor = new PostSaveProcessor({ handlers: [handler1, handler2] });
            await processor.flushAsync();
            expect(handler1.flushAsync).toHaveBeenCalledTimes(1);
            expect(handler2.flushAsync).toHaveBeenCalledTimes(1);
        });
    });
});
