const { describe, test, expect } = require('@jest/globals');
const { WriteResponder } = require('../../../../../operations/writePipeline/responder/writeResponder');

/**
 * A responder that implements every required method.
 */
class CompleteResponder extends WriteResponder {
    /**
     * Returns an empty read.
     * @returns {Promise<{context: null, items: Object[], requestErrors: Object[], wasIncomingAList: boolean}>}
     */
    async readAsync () {
        return { context: null, items: [], requestErrors: [], wasIncomingAList: false };
    }

    /**
     * Returns no failure results.
     * @returns {Object[]}
     */
    failureResults () {
        return [];
    }

    /**
     * Returns no results.
     * @returns {Object[]}
     */
    results () {
        return [];
    }

    /**
     * Returns an empty response.
     * @returns {Object[]}
     */
    toResponse () {
        return [];
    }

    /**
     * Records nothing.
     * @returns {void}
     */
    recordMetrics () {
        return undefined;
    }
}

/**
 * A responder that leaves out `results` and `recordMetrics`.
 */
class PartialResponder extends WriteResponder {
    /**
     * Returns an empty read.
     * @returns {Promise<{context: null, items: Object[], requestErrors: Object[], wasIncomingAList: boolean}>}
     */
    async readAsync () {
        return { context: null, items: [], requestErrors: [], wasIncomingAList: false };
    }

    /**
     * Returns no failure results.
     * @returns {Object[]}
     */
    failureResults () {
        return [];
    }

    /**
     * Returns an empty response.
     * @returns {Object[]}
     */
    toResponse () {
        return [];
    }
}

/**
 * A responder whose prototype sets `results` to a string instead of a method.
 */
class NonFunctionResponder extends CompleteResponder {}
NonFunctionResponder.prototype.results = 'not a function';

/**
 * Runs `build` and returns whether it built a `WriteResponder` and the message of the error it
 * threw, if any.
 */
const construct = (build) => {
    try {
        return { constructed: build() instanceof WriteResponder, error: null };
    } catch (e) {
        return { constructed: false, error: e.message };
    }
};

describe('WriteResponder', () => {
    test.each([
        {
            name: 'a subclass that implements every method',
            build: () => new CompleteResponder(),
            expected: { constructed: true, error: null }
        },
        {
            name: 'a subclass missing some methods',
            build: () => new PartialResponder(),
            expected: { constructed: false, error: 'PartialResponder must implement: results, recordMetrics' }
        },
        {
            name: 'a subclass whose prototype sets a method to a non-function',
            build: () => new NonFunctionResponder(),
            expected: { constructed: false, error: 'NonFunctionResponder must implement: results' }
        },
        {
            name: 'an anonymous subclass missing every method',
            build: () => new (class extends WriteResponder {})(),
            expected: {
                constructed: false,
                error: 'WriteResponder subclass must implement: readAsync, failureResults, results, toResponse, recordMetrics'
            }
        },
        {
            name: 'WriteResponder itself',
            build: () => new WriteResponder(),
            expected: {
                constructed: false,
                error: 'WriteResponder must implement: readAsync, failureResults, results, toResponse, recordMetrics'
            }
        }
    ])('constructing $name checks that every method is implemented', ({ build, expected }) => {
        const outcome = construct(build);

        expect(outcome).toStrictEqual(expected);
    });
});
