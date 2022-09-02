const {validateResource} = require('../utils/validator.util');
const {assertFail} = require('../utils/assertType');
const {diff} = require('jest-diff');
const deepEqual = require('fast-deep-equal');
const {expect} = require('@jest/globals');


/**
 * @typedef JestUtils
 * @type {Object}
 * @property {function(string, undefined, undefined, Object): string} matcherHint
 * @property {function(Object): string} printExpected
 * @property {function(Object): string} printReceived
 */

function cleanMeta(resource) {
    if (resource.meta && resource.meta.tag) {
        resource.meta.tag.forEach((tag) => {
            if (tag['system'] === 'https://www.icanbwell.com/queryTime') {
                delete tag['display'];
            }
        });
    }
    if (resource.meta) {
        delete resource.meta.lastUpdated;
    }

    return resource;
}

/**
 * compares two bundles
 * @param {Object} body
 * @param {Object} expected
 * @param {(Resource) => Resource} [fnCleanResource]
 * @param {boolean} ignoreMetaTags
 * @returns {boolean}
 */
function compareBundles({body, expected, fnCleanResource, ignoreMetaTags = false}) {
    // console.log(JSON.stringify(body, null, 2));
    // clear out the lastUpdated column since that changes
    // expect(body['entry'].length).toBe(2);
    delete body['timestamp'];
    delete expected['timestamp'];
    delete body['link'];

    cleanMeta(body);
    if (body.entry) {
        body.entry.forEach((element) => {
            cleanMeta(element['resource']);
            if (fnCleanResource) {
                fnCleanResource(element['resource']);
            }
        });
    }
    delete expected['link'];

    if (expected.meta && expected.meta.tag) {
        if (ignoreMetaTags) {
            expected.meta.tag = [];
        }
        cleanMeta(expected);
    }
    if (expected.entry) {
        expected.entry.forEach((element) => {
            cleanMeta(element['resource']);
            delete element['resource']['$schema'];
            if (fnCleanResource) {
                fnCleanResource(element['resource']);
            }
        });
    }

    // now sort the two lists so the comparison is agnostic to order
    body.entry = body.entry.sort((a, b) =>
        `${a.resourceType}/${a.id}`.localeCompare(`${b.resourceType}/${b.id}`)
    );
    expected.entry = expected.entry.sort((a, b) =>
        `${a.resourceType}/${a.id}`.localeCompare(`${b.resourceType}/${b.id}`)
    );

    body.entry.forEach((element) => {
        delete element['fullUrl'];
        if (element['resource']) {
            cleanMeta(element['resource']);
            if (element['resource']['contained']) {
                element['resource']['contained'].forEach((containedElement) => {
                    cleanMeta(containedElement);
                });
                // sort the list
                element['resource']['contained'] = element['resource']['contained'].sort((a, b) =>
                    `${a.resourceType}/${a.id}`.localeCompare(`${b.resourceType}/${b.id}`)
                );
            }
        }
    });
    expected.entry.forEach((element) => {
        delete element['fullUrl'];
        cleanMeta(element['resource']);
        if ('$schema' in element) {
            delete element['$schema'];
        }
        if (element['resource']['contained']) {
            element['resource']['contained'].forEach((containedElement) => {
                cleanMeta(containedElement);
            });
            // sort the list
            element['resource']['contained'] = element['resource']['contained'].sort((a, b) =>
                `${a.resourceType}/${a.id}`.localeCompare(`${b.resourceType}/${b.id}`)
            );
        }
    });
    return deepEqual(body, expected);
}

/**
 * check content
 * @param {Object|Object[]} actual
 * @param {Object|Object[]} expected
 * @param {JestUtils} utils
 * @param options
 * @param expand
 * @param [fnCleanResource]
 * @returns {{actual, pass: boolean, expected, message: {(): string, (): string}}}
 */
function checkContent({actual, expected, utils, options, expand, fnCleanResource}) {
    let pass = false;
    if (!(Array.isArray(actual)) && actual.resourceType === 'Bundle') {
        if (!Array.isArray(expected)) {
            pass = compareBundles({body: actual, expected, fnCleanResource});
        } else {
            pass = deepEqual(actual.entry.map(e => e.resource), expected);
        }
    } else if (!(Array.isArray(expected)) && expected.resourceType === 'Bundle') {
        if (!Array.isArray(actual)) {
            pass = compareBundles({body: actual, expected, fnCleanResource});
        } else {
            pass = deepEqual(actual, expected.entry.map(e => e.resource));
        }
    } else {
        if (fnCleanResource) {
            if (Array.isArray(actual)) {
                actual.forEach(a => fnCleanResource(a));
            } else {
                fnCleanResource(actual);
            }
            if (Array.isArray(expected)) {
                expected.forEach(a => fnCleanResource(a));
            } else {
                fnCleanResource(expected);
            }
        }

        pass = deepEqual(actual, expected);
    }
    const message = pass ? () =>
            // eslint-disable-next-line prefer-template
            utils.matcherHint('toBe', undefined, undefined, options) +
            '\n\n' +
            `Expected: not ${utils.printExpected(expected)}\n` +
            `Received: ${utils.printReceived(actual)}`
        : () => {
            const diffString = diff(expected, actual, {
                expand: expand,
            });
            return (
                // eslint-disable-next-line prefer-template
                utils.matcherHint('toBe', undefined, undefined, options) +
                '\n\n' +
                (diffString && diffString.includes('- Expect') ?
                    `Difference:\n\n${diffString}` :
                    `Expected: ${utils.printExpected(expected)}\n` +
                    `Received: ${utils.printReceived(actual)}`)
            );
        };
    return {actual: actual, expected: expected, message, pass};
}

/**
 * expect response
 * https://jestjs.io/docs/expect#custom-matchers-api
 * @param {import('http').ServerResponse} resp
 * @param {Object|Object[]} expected
 * @param {(Resource) => Resource} [fnCleanResource]
 * @returns {{pass: boolean, message: () => string}}
 */
function toHaveResponse(resp, expected, fnCleanResource) {
    const options = {
        comment: 'Object.is equality',
        isNot: this.isNot,
        promise: this.promise,
    };
    /**
     * @type {JestUtils}
     */
    const utils = this.utils;
    if (Array.isArray(resp.body) && !Array.isArray(expected)) {
        expected = [expected];
    }
    if (!Array.isArray(resp.body) && !resp.body.data && Array.isArray(expected)) {
        expected = expected[0];
    }
    if (!Array.isArray(resp.body) && resp.body.resourceType === 'Bundle') {
        // handle bundles being returned
        if (Array.isArray(expected)) {
            // make into a bundle if it is not
            expected = {
                resourceType: 'Bundle',
                type: 'searchset',
                entry: expected.map((e) => {
                    return {resource: e};
                }),
            };
        }
        return checkContent({
            actual: resp.body, expected, utils, options, expand: this.expand,
            fnCleanResource
        });
    } else if (resp.body.data && !(expected.body && expected.body.data) && !(expected.data)) {
        // GraphQL response
        // get first property of resp.body.data
        // eslint-disable-next-line no-unused-vars
        let [propertyName, propertyValue] = Object.entries(resp.body.data)[0];
        // see if the return value is a bundle
        if (propertyValue && !(Array.isArray(propertyValue)) && propertyValue.entry && Array.isArray(expected)) {
            propertyValue = propertyValue.entry.map(e => e.resource);
        }
        if (Array.isArray(propertyValue)) {
            propertyValue.forEach(item => cleanMeta(item));
        } else {
            cleanMeta(propertyValue);
        }
        if (Array.isArray(expected)) {
            expected.forEach(item => cleanMeta(item));
        } else {
            cleanMeta(expected);
        }
        return checkContent({
            actual: propertyValue, expected, utils, options, expand: this.expand,
            fnCleanResource
        });
    } else {
        if (Array.isArray(resp.body)) {
            resp.body.forEach((element) => {
                // clean out stuff that changes
                cleanMeta(element);
            });
        } else {
            cleanMeta(resp.body);
            if (resp.body.resourceType) {
                const operationOutcome = validateResource(
                    resp.body,
                    resp.body.resourceType,
                    ''
                );
                if (operationOutcome && operationOutcome.statusCode === 400) {
                    assertFail({
                        source: 'expectResponse',
                        message: 'FHIR validation failed',
                        args: {
                            resourceType: resp.body.resourceType,
                            resource: resp.body,
                            operationOutcome: operationOutcome,
                        },
                    });
                }
            }
        }
        if (Array.isArray(expected)) {
            expected.forEach((element) => {
                // clean out stuff that changes
                cleanMeta(element);
            });
        } else {
            cleanMeta(expected);
        }
    }
    return checkContent({
        actual: resp.body, expected, utils, options, expand: this.expand,
        fnCleanResource
    });
}

/**
 *
 * @param {import('http').ServerResponse} resp
 * @param {number} expectedStatusCode
 */
function toHaveStatusCode(resp, expectedStatusCode) {
    const pass = resp.status === expectedStatusCode;
    const message = pass ? () =>
            `Status Code did not match: ${resp.text}`
        : () => `Status Code did not match: ${resp.text}`;
    return {actual: resp.status, expected: expectedStatusCode, message, pass};
}

/**
 *
 * @param {import('http').ServerResponse} resp
 */
function toHaveStatusOk(resp) {
    return toHaveStatusCode(resp, 200);
}

/**
 * asserts
 * @param {import('http').ServerResponse} resp
 * @param {Object[]|Object} checks
 */
function toHaveMergeResponse(resp, checks) {
    if (resp.status !== 200) {
        return toHaveStatusOk(resp);
    }
    try {
        const body = resp.body;
        if (Array.isArray(body)) {
            if (!Array.isArray(checks)) {
                checks = [checks];
            }
            for (const bodyItemIndex in body) {
                const bodyItem = body[`${bodyItemIndex}`];
                const expectedItem = checks[`${bodyItemIndex}`];
                if (expectedItem) {
                    expect(bodyItem).toEqual(expect.objectContaining(expectedItem));
                }
            }
        } else {
            const firstCheck = Array.isArray(checks) ? checks[0] : checks;
            if (firstCheck) {
                expect(body).toEqual(expect.objectContaining(firstCheck));
            }
        }
        // assertMergeIsSuccessful(resp.body);
    } catch (e) {
        const pass = false;
        const message = () => `Merge failed: ${JSON.stringify(resp.body)}`;
        return {actual: resp.body, expected: checks, message, pass};
    }
    return {
        pass: true,
        message: () => 'Merge Succeeded'
    };
}

/**
 * expects resource count
 * @param {import('http').ServerResponse} resp
 * @param {number} expected
 */
function toHaveResourceCount(resp, expected) {
    if (resp.status !== 200) {
        return toHaveStatusOk(resp);
    }
    let count;
    if (!(Array.isArray(resp.body))) {
        if (resp.body.resourceType === 'Bundle') {
            count = resp.body.entry.length;
        } else if (resp.body.resourceType) {
            count = 1;
        } else {
            count = 0;
        }
    } else {
        count = resp.body.length;
    }
    const pass = count === expected;
    const message = pass ? () =>
            `Resource count matched: ${resp.text}`
        : () => `Resource count did not match: ${resp.text}`;
    return {actual: count, expected: expected, message, pass};
}

module.exports = {
    toHaveResponse,
    toHaveStatusCode,
    toHaveStatusOk,
    toHaveMergeResponse,
    toHaveResourceCount
};
