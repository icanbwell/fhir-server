'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

const mockCaptureException = jestObj.fn();
jestObj.mock('@sentry/node', () => ({
    captureException: mockCaptureException
}));

const { captureException } = require('../../../../operations/common/sentry');

describe('captureException', () => {
    test('delegates to Sentry.captureException', () => {
        const error = new Error('test error');
        const context = { tags: { source: 'test' } };

        captureException(error, context);

        expect(mockCaptureException).toHaveBeenCalledWith(error, context);
    });

    test('works without context', () => {
        const error = new Error('no context');

        captureException(error);

        expect(mockCaptureException).toHaveBeenCalledWith(error, undefined);
    });
});
