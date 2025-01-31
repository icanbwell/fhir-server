const { validateResource } = require('../utils/validator.util');
const { assertFail, assertIsValid } = require('../utils/assertType');
const { diff } = require('jest-diff');
const deepEqual = require('fast-deep-equal');
const { expect } = require('@jest/globals');
const moment = require('moment-timezone');
const { YearMonthPartitioner } = require('../partitioners/yearMonthPartitioner');
const { ndjsonToJsonText } = require('ndjson-to-json-text');
const { fhirContentTypes } = require('../utils/contentTypes');
const { csv2json } = require('csv42');
const _ = require('lodash');

/**
 * @typedef JestUtils
 * @type {Object}
 * @property {function(string, undefined, undefined, Object): string} matcherHint
 * @property {function(Object): string} printExpected
 * @property {function(Object): string} printReceived
 */

function cleanMeta (resource) {
    assertIsValid(resource, 'resource is null');
    const fieldDate = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
    /**
     * @type {string}
     */
    const auditCollectionName = YearMonthPartitioner.getPartitionNameFromYearMonth(
        { fieldValue: fieldDate.toString(), resourceWithBaseVersion: 'AuditEvent_4_0_0' }
    );

    if (resource.meta && resource.meta.tag) {
        resource.meta.tag.forEach((tag) => {
            if (tag.system === 'https://www.icanbwell.com/queryTime' && tag.display) {
                delete tag.display;
            }
            if (tag.system === 'https://www.icanbwell.com/queryExplain' && tag.display) {
                delete tag.display;
            }
            if (tag.system === 'https://www.icanbwell.com/queryExplainSimple' && tag.display) {
                delete tag.display;
            }
            if (tag.system === 'https://www.icanbwell.com/query' && tag.display) {
                tag.display = tag.display.replace('db.AuditEvent_4_0_0.', `db.${auditCollectionName}.`);
            }
            if (tag.system === 'https://www.icanbwell.com/queryCollection' && tag.code && tag.code.startsWith('AuditEvent_4_0_0')) {
                tag.code = `${auditCollectionName}`;
            }
        });
    }
    if (resource.meta) {
        delete resource.meta.lastUpdated;
    }
    if (resource.contained) {
        resource.contained.forEach((containedElement) => {
            cleanMeta(containedElement);
        });
    }

    return resource;
}

/**
 * cleans request Id
 * @param {Object} request
 */
function cleanRequestId (request) {
    if (request && request.id) {
        delete request.id;
    }
}

/**
 * compares two bundles
 * @param {Object} body
 * @param {Object} expected
 * @param {(Resource) => Resource} [fnCleanResource]
 * @param {boolean} ignoreMetaTags
 * @returns {boolean}
 */
function compareBundles ({ body, expected, fnCleanResource, ignoreMetaTags = false }) {
    // logInfo(body);
    // clear out the lastUpdated column since that changes
    // expect(body['entry'].length).toBe(2);
    delete body.timestamp;
    delete expected.timestamp;
    delete body.link;
    delete body.id; // This is uniquely created each time

    cleanMeta(body);
    if (body.entry) {
        body.entry.forEach((element) => {
            cleanRequestId(element.request);
            cleanMeta(element.resource);
            if (fnCleanResource) {
                fnCleanResource(element.resource);
            }
        });
        // now sort the two lists so the comparison is agnostic to order
        body.entry = body.entry.sort((a, b) =>
            `${a.resourceType}/${a.id}`.localeCompare(`${b.resourceType}/${b.id}`)
        );
        body.entry.forEach((element) => {
            delete element.fullUrl;
            if (element.resource) {
                cleanMeta(element.resource);
                if (element.resource.contained) {
                    element.resource.contained.forEach((containedElement) => {
                        cleanMeta(containedElement);
                    });
                    // sort the list
                    element.resource.contained = element.resource.contained.sort((a, b) =>
                        `${a.resourceType}/${a.id}`.localeCompare(`${b.resourceType}/${b.id}`)
                    );
                }
            }
        });
    }
    delete expected.link;

    if (expected.meta && expected.meta.tag) {
        if (ignoreMetaTags) {
            expected.meta.tag = [];
        }
        cleanMeta(expected);
    }
    if (expected.entry) {
        expected.entry.forEach((element) => {
            cleanRequestId(element.request);
            cleanMeta(element.resource);
            delete element.resource.$schema;
            if (fnCleanResource) {
                fnCleanResource(element.resource);
            }
        });
        expected.entry = expected.entry.sort((a, b) =>
            `${a.resourceType}/${a.id}`.localeCompare(`${b.resourceType}/${b.id}`)
        );
        expected.entry.forEach((element) => {
            delete element.fullUrl;
            cleanMeta(element.resource);
            if ('$schema' in element) {
                delete element.$schema;
            }
            if (element.resource.contained) {
                element.resource.contained.forEach((containedElement) => {
                    cleanMeta(containedElement);
                });
                // sort the list
                element.resource.contained = element.resource.contained.sort((a, b) =>
                    `${a.resourceType}/${a.id}`.localeCompare(`${b.resourceType}/${b.id}`)
                );
            }
        });
    }

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
function checkContent ({ actual, expected, utils, options, expand, fnCleanResource }) {
    let pass = false;
    if (!(Array.isArray(actual)) && actual.resourceType === 'Bundle') {
        if (!Array.isArray(expected)) {
            pass = compareBundles({ body: actual, expected, fnCleanResource });
        } else {
            pass = deepEqual(actual.entry.map(e => e.resource), expected);
        }
    } else if (!(Array.isArray(expected)) && expected.resourceType === 'Bundle') {
        if (!Array.isArray(actual)) {
            pass = compareBundles({ body: actual, expected, fnCleanResource });
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

            utils.matcherHint('toBe', undefined, undefined, options) +
            '\n\n' +
            `Expected: not ${utils.printExpected(expected)}\n` +
            `Received: ${utils.printReceived(actual)}`
        : () => {
            const diffString = diff(expected, actual, {
                expand
            });
            return (

                (utils.matcherHint('toBe', undefined, undefined, options) +
                    '\n\n' + (diffString && diffString.includes('- Expect') ? `Difference:\n\n${diffString}` : `Expected: ${utils.printExpected(expected)}\n` +
                        `Received: ${utils.printReceived(actual)}`))
            );
        };
    return { actual, expected, message, pass };
}

/**
 * Sorts an array of entries based on the value of the 'uuid' identifier or 'id' if 'uuid' is not present.
 * @param {Object[]} entries Array of entries to be sorted
 * @returns {Object[]} Sorted array of entries
 */
function sortEntriesByUUID (entries) {
    entries?.sort((a, b) => {
        // Consider uuid or id of resource
        const getUUID = (resource) => {
            if (Array.isArray(resource.identifier)) {
                const uuid = resource.identifier.find(identifier => identifier.id === 'uuid');
                return uuid ? uuid.value : undefined;
            } else if (resource.id) {
                return resource.id;
            }
            return undefined;
        };

        const uuidA = getUUID(a.resource);
        const uuidB = getUUID(b.resource);
        if (uuidA && uuidB) {
            return uuidA.localeCompare(uuidB);
        } else if (uuidA) {
            return -1;
        } else if (uuidB) {
            return 1;
        }
        return 0;
    });
    return entries;
}

/**
 * expect response
 * https://jestjs.io/docs/expect#custom-matchers-api
 * @param {import('http').ServerResponse} resp
 * @param {Object|Object[]|string} expectedIn
 * @param {(Resource) => Resource} [fnCleanResource]
 * @returns {{pass: boolean, message: () => string}}
 */
function toHaveResponse (resp, expectedIn, fnCleanResource) {
    const options = {
        comment: 'Object.is equality',
        isNot: this.isNot,
        promise: this.promise
    };
    /**
     * @type {JestUtils}
     */
    const utils = this.utils;
    const contentType = resp.headers['content-type'];
    let body;
    let expected;
    if (contentType === fhirContentTypes.csv) {
        body = csv2json(resp.text);
        expected = csv2json(expectedIn);
    } else {
        body = contentType === 'application/fhir+ndjson' ? JSON.parse(ndjsonToJsonText(resp.text)) : resp.body;
        expected = expectedIn;
    }
    if (Array.isArray(expected)) {
        expected.sort((a, b) => {
            const uuidA = a.identifier?.find(identifier => identifier.id === 'uuid')?.value;
            const uuidB = b.identifier?.find(identifier => identifier.id === 'uuid')?.value;

            // Check if both UUIDs exist before comparing
            if (uuidA && uuidB) {
                return uuidA.localeCompare(uuidB);
            } else if (uuidA) {
                // If one UUID is missing, prioritize the entry with a UUID
                return -1;
            } else if (uuidB) {
                return 1;
            }
            // If both UUIDs are missing, maintain the order
            return 0;
        });
    }

    if (Array.isArray(body) && !Array.isArray(expected)) {
        expected = [expected];
    }
    if (!Array.isArray(body) && !body.data && Array.isArray(expected)) {
        expected = expected[0];
    }
    if (!Array.isArray(body) && body.resourceType === 'Bundle') {
        // handle bundles being returned
        if (Array.isArray(expected)) {
            // make into a bundle if it is not
            expected = {
                resourceType: 'Bundle',
                type: 'searchset',
                entry: expected.map((e) => {
                    return { resource: e };
                })
            };
        }
        expected.entry = sortEntriesByUUID(expected.entry);
        body.entry = sortEntriesByUUID(body.entry);
        return checkContent({
            actual: body,
            expected,
            utils,
            options,
            expand: this.expand,
            fnCleanResource
        });
    } else if (body.data && !(expected.body && expected.body.data) && !(expected.data)) {
        // GraphQL response
        // get first property of resp.body.data

        let [propertyName, propertyValue] = Object.entries(body.data)[0];
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
            actual: propertyValue,
            expected,
            utils,
            options,
            expand: this.expand,
            fnCleanResource
        });
    } else {
        if (Array.isArray(body)) {
            body.forEach((element) => {
                // clean out stuff that changes
                cleanMeta(element);
            });
        } else {
            cleanMeta(body);
            if (body.resourceType) {
                const operationOutcome = validateResource(
                    {
                        resourceBody: body,
                        resourceName: body.resourceType,
                        path: ''
                    }
                );
                if (operationOutcome && operationOutcome.statusCode === 400) {
                    assertFail({
                        source: 'expectResponse',
                        message: 'FHIR validation failed',
                        args: {
                            resourceType: body.resourceType,
                            resource: body,
                            operationOutcome
                        }
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

        // clean out meta for graphql
        if (expected.data) {
            for (const [, value] of Object.entries(expected.data)) {
                if (value) {
                    cleanMeta(value);
                }
            }
        }
        if (body.data) {
            for (const [, value] of Object.entries(body.data)) {
                if (value) {
                    cleanMeta(value);
                }
            }
        }
    }
    return checkContent({
        actual: body,
        expected,
        utils,
        options,
        expand: this.expand,
        fnCleanResource
    });
}

/**
 * expect response
 * https://jestjs.io/docs/expect#custom-matchers-api
 * @param {import('http').ServerResponse} resp
 * @param {Object|Object[]} expected
 * @param {string} queryName
 * @param {(Resource) => Resource} [fnCleanResource]
 * @returns {{pass: boolean, message: () => string}}
 */
function toHaveGraphQLResponse (resp, expected, queryName, fnCleanResource) {
    const options = {
        comment: 'Object.is equality',
        isNot: this.isNot,
        promise: this.promise
    };
    /**
     * @type {JestUtils}
     */
    const utils = this.utils;
    const contentType = resp.headers['content-type'];
    const body = contentType === 'application/fhir+ndjson' ? JSON.parse(ndjsonToJsonText(resp.text)) : resp.body;
    if (Array.isArray(body) && !Array.isArray(expected)) {
        expected = [expected];
    }
    if (!Array.isArray(body) && !body.data && Array.isArray(expected)) {
        expected = expected[0];
    }
    if (!Array.isArray(body) && body.resourceType === 'Bundle') {
        // handle bundles being returned
        if (Array.isArray(expected)) {
            // make into a bundle if it is not
            expected = {
                resourceType: 'Bundle',
                type: 'searchset',
                entry: expected.map((e) => {
                    return { resource: e };
                })
            };
        }
        return checkContent({
            actual: body,
            expected,
            utils,
            options,
            expand: this.expand,
            fnCleanResource
        });
    } else if (body.data && !(expected.body && expected.body.data) && !(expected.data)) {
        // GraphQL response
        // get first property of resp.body.data
        let propertyValue = body.data[`${queryName}`];
        expect(body.errors).toBeUndefined();
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
            actual: propertyValue,
            expected,
            utils,
            options,
            expand: this.expand,
            fnCleanResource
        });
    } else {
        if (Array.isArray(body)) {
            body.forEach((element) => {
                // clean out stuff that changes
                cleanMeta(element);
            });
        } else {
            cleanMeta(body);
            if (body.resourceType) {
                const operationOutcome = validateResource(
                    {
                        resourceBody: body,
                        resourceName: body.resourceType,
                        path: ''
                    }
                );
                if (operationOutcome && operationOutcome.statusCode === 400) {
                    assertFail({
                        source: 'expectResponse',
                        message: 'FHIR validation failed',
                        args: {
                            resourceType: body.resourceType,
                            resource: body,
                            operationOutcome
                        }
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

        // clean out meta for graphql
        if (expected.data) {
            for (const [, value] of Object.entries(expected.data)) {
                if (value) {
                    cleanMeta(value);
                }
            }
        }
        if (body.data) {
            for (const [, value] of Object.entries(body.data)) {
                if (value) {
                    cleanMeta(value);
                }
            }
        }
    }
    return checkContent({
        actual: body,
        expected,
        utils,
        options,
        expand: this.expand,
        fnCleanResource
    });
}

/**
 *
 * @param {import('http').ServerResponse} resp
 * @param {number} expectedStatusCode
 */
function toHaveStatusCode (resp, expectedStatusCode) {
    const pass = resp.status === expectedStatusCode;
    const message = pass ? () =>
            `Status Code did match: ${resp.text}`
        : () => `Status Code did not match: ${resp.text}`;
    return { actual: resp.status, expected: expectedStatusCode, message, pass };
}

/**
 *
 * @param {import('http').ServerResponse} resp
 */
function toHaveStatusOk (resp) {
    return toHaveStatusCode(resp, 200);
}

/**
 * asserts
 * @param {import('http').ServerResponse} resp
 * @param {Object[]|Object} checks
 */
function toHaveMergeResponse (resp, checks) {
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
        const message = () => `Merge failed: ${JSON.stringify(resp.body)} ${e}`;
        return { actual: resp.body, expected: checks, message, pass };
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
function toHaveResourceCount (resp, expected) {
    if (resp.status !== 200) {
        return toHaveStatusOk(resp);
    }
    let count;
    const contentType = resp.headers['content-type'];
    if (contentType === fhirContentTypes.csv) {
        const lineCount = resp.text.split('\n').filter(l => l !== '').length;
        count = lineCount > 0 ? lineCount - 1 : 0;
    } else {
        const body = contentType === 'application/fhir+ndjson' ? JSON.parse(ndjsonToJsonText(resp.text)) : resp.body;
        if (!(Array.isArray(body))) {
            if (body.resourceType === 'Bundle') {
                count = body.entry ? body.entry.length : 0;
            } else if (body.resourceType) {
                count = 1;
            } else {
                count = 0;
            }
        } else {
            count = body.length;
        }
    }
    const pass = count === expected;
    const message = pass ? () =>
            `Resource count matched: ${resp.text}`
        : () => `Resource count did not match: ${resp.text}`;
    return { actual: count, expected, message, pass };
}

/**
 * matches mongo query by sorting any nested arrays
 * and removes query part from received and expected reponse
 * @param {import('http').ServerResponse} resp
 * @param {Object|Object[]} expected
 * @param {string} expectedTagPath
 */
function toHaveMongoQuery(resp, expected, expectedTagPath = null) {
    const sortNestedArrays = (obj) => {
        if (Array.isArray(obj)) {
            return obj.map(sortNestedArrays);
        } else if (obj && typeof obj === 'object') {
            const newObj = {};
            for (const key in obj) {
                if (key === '$in' && Array.isArray(obj[key])) {
                    newObj[key] = _.sortBy(obj[key]);
                } else {
                    newObj[key] = sortNestedArrays(obj[key]);
                }
            }
            return newObj;
        }
        return obj;
    };

    const parseQueryString = (queryString) => {
        const collectionNameRegex = /db\.(\w+_\d+_\d+_\d+)/;
        // Extract the collection name
        const collectionName = queryString.match(collectionNameRegex)[1];

        let queryPart = queryString.match(/\(([^)]+)\)/)[1];

        // Find the position of the last comma outside of braces
        let braceCount = 0;
        let lastCommaIndex = -1;
        for (let i = 0; i < queryPart.length; i++) {
            if (queryPart[i] === '{') braceCount++;
            if (queryPart[i] === '}') braceCount--;
            if (queryPart[i] === ',' && braceCount === 0) {
                lastCommaIndex = i;
            }
        }

        // Replace single quotes with double quotes
        queryPart = queryPart.replace(/'/g, '"');

        let queryContent = queryPart.substring(0, lastCommaIndex).trim();
        let projectionContent = queryPart.substring(lastCommaIndex + 1).trim();

        let jsonQuery = {};
        let jsonProjection = {};
        try {
            jsonQuery = JSON.parse(queryContent);
            jsonProjection = JSON.parse(projectionContent);
        } catch (error) {
            throw new Error('Failed to parse query: ' + error.message);
        }
        return {
            collection: collectionName,
            query: sortNestedArrays(jsonQuery),
            projection: jsonProjection
        };
    };

    let requestTag = resp?.body?.meta?.tag;
    let expectedTag = expected?.meta?.tag;
    if (expectedTagPath) {
        requestTag = `body.${expectedTagPath}`.split('.').reduce((p,c)=>p&&p[c]||null, resp)
        expectedTag = `${expectedTagPath}`.split('.').reduce((p,c)=>p&&p[c]||null, expected)
    }

    let receivedQuery = [];
    requestTag.forEach((t) => {
        if (t.system === 'https://www.icanbwell.com/query') {
            receivedQuery = t.display.split('|').sort();
            t.display = '';
        }
    });

    let expectedQuery = [];
    expectedTag.forEach((t) => {
        if (t.system === 'https://www.icanbwell.com/query') {
            expectedQuery = t.display.split('|').sort();
            t.display = '';
        }
    });

    // First check equal number of queries are performed
    expect(receivedQuery.length).toEqual(expectedQuery.length);

    // Compare each query
    receivedQuery.forEach((element, index) => {
        expect(parseQueryString(element)).toEqual(parseQueryString(expectedQuery[index]));
    });

    let receivedCollections = "";
    requestTag.forEach((t) => {
        if (t.system === 'https://www.icanbwell.com/queryCollection') {
            receivedCollections = t.code;
            t.code = '';
        }
    });

    let expectedCollections = "";
    expectedTag.forEach((t) => {
        if (t.system === 'https://www.icanbwell.com/queryCollection') {
            expectedCollections = t.code;
            t.code = '';
        }
    });

    // Compare query collections
    expect(receivedCollections.replace(/[[\]]/g, '').split(',').sort()).toEqual(
        expectedCollections.replace(/[[\]]/g, '').split(',').sort()
    );

    let receivedQueryOptions = "";
    requestTag.forEach((t) => {
        if (t.system === 'https://www.icanbwell.com/queryOptions') {
            receivedQueryOptions = JSON.parse(t.display.replace(/'/g, '"'));
            t.display = '';
        }
    });

    let expectedQueryOptions = "";
    expectedTag.forEach((t) => {
        if (t.system === 'https://www.icanbwell.com/queryOptions') {
            expectedQueryOptions = JSON.parse(t.display.replace(/'/g, '"'));
            t.display = '';
        }
    });

    // Compare query options
    expect(
        Array.isArray(receivedQueryOptions)
            ? receivedQueryOptions.map((element) => JSON.stringify(element)).sort()
            : receivedQueryOptions
    ).toEqual(
        Array.isArray(expectedQueryOptions)
            ? expectedQueryOptions.map((element) => JSON.stringify(element)).sort()
            : expectedQueryOptions
    );

    return { actual: resp, expected, message: '', pass: true };
}

// NOTE: Also need to register any new ones with Jest in src/tests/testSetup.js
module.exports = {
    toHaveResponse,
    toHaveStatusCode,
    toHaveStatusOk,
    toHaveMergeResponse,
    toHaveResourceCount,
    cleanMeta,
    toHaveGraphQLResponse,
    sortEntriesByUUID,
    toHaveMongoQuery
};
