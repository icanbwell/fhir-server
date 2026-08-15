'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

const mockInitSentry = jestObj.fn();

jestObj.mock('../../../utils/initSentry', () => ({
    initSentry: mockInitSentry
}));

// errorHandler.js registers real process-level listeners as a require-time side effect --
// mock it so requiring it here doesn't attach any.
jestObj.mock('../../../middleware/errorHandler', () => ({}));

const { initStandaloneEntrypointSentry } = require('../../../utils/initStandaloneEntrypointSentry');

describe('initStandaloneEntrypointSentry', () => {
    beforeEach(() => {
        jestObj.clearAllMocks();
    });

    test('initializes Sentry', () => {
        initStandaloneEntrypointSentry();

        expect(mockInitSentry).toHaveBeenCalledWith();
    });

    test('does not throw when requiring the shared error handler', () => {
        expect(() => initStandaloneEntrypointSentry()).not.toThrow();
    });
});
