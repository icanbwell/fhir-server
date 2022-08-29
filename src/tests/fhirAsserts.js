const {expect} = require('@jest/globals');
const {assertFail} = require('../utils/assertType');
const {validateResource} = require('../utils/validator.util');

/**
 * confirms that object was created
 * @param {Object | [Object]} body
 * @param {boolean} expectCreate
 */
function assertMergeIsSuccessful(body, expectCreate = true) {
    console.log(JSON.stringify(body, null, 2));
    try {
        if (Array.isArray(body)) {
            for (const bodyItem of body) {
                if (expectCreate) {
                    expect(bodyItem['created']).toBe(true);
                } else {
                    expect(bodyItem['updated']).toBe(true);
                }
            }
        } else {
            if (expectCreate) {
                expect(body['created']).toBe(true);
            } else {
                expect(body['updated']).toBe(true);
            }
        }
    } catch (e) {
        e.message += `, body: ${JSON.stringify(body)}`;
        throw e;
    }
}

/**
 * compares two bundles
 * @param {Object} body
 * @param {Object} expected
 * @param {(Resource) => Resource} [fnCleanResource]
 * @param {Boolean} ignoreMetaTags
 */
function assertCompareBundles({body, expected, fnCleanResource, ignoreMetaTags = false}) {
    // console.log(JSON.stringify(body, null, 2));
    // clear out the lastUpdated column since that changes
    // expect(body['entry'].length).toBe(2);
    delete body['timestamp'];
    delete expected['timestamp'];
    delete body['link'];
    if (body.meta && body.meta.tag) {
        if (ignoreMetaTags) {
            body.meta.tag = [];
        }
        body.meta.tag.forEach(tag => {
            if (tag['system'] === 'https://www.icanbwell.com/queryTime') {
                delete tag['display'];
            }
        });
    }
    expect(body.entry).not.toBeNull();
    expect(body.entry).not.toBeUndefined();
    body.entry.forEach(element => {
        if (element['resource'] && element['resource']['meta']) {
            delete element['resource']['meta']['lastUpdated'];
        }
        if (fnCleanResource) {
            fnCleanResource(element['resource']);
        }
    });
    delete expected['link'];

    if (expected.meta && expected.meta.tag) {
        if (ignoreMetaTags) {
            expected.meta.tag = [];
        }
        expected.meta.tag.forEach(tag => {
            if (tag['system'] === 'https://www.icanbwell.com/queryTime') {
                delete tag['display'];
            }

        });
    }
    expected.entry.forEach(element => {
        if (element['resource']['meta']) {
            delete element['resource']['meta']['lastUpdated'];
        }
        delete element['resource']['$schema'];
        if (fnCleanResource) {
            fnCleanResource(element['resource']);
        }
    });

    // now sort the two lists so the comparison is agnostic to order
    body.entry = body.entry.sort((a, b) => `${a.resourceType}/${a.id}`.localeCompare(`${b.resourceType}/${b.id}`));
    expected.entry = expected.entry.sort((a, b) => `${a.resourceType}/${a.id}`.localeCompare(`${b.resourceType}/${b.id}`));

    body.entry.forEach(element => {
        delete element['fullUrl'];
        if (element['resource']) {
            if (element['resource']['meta']) {
                delete element['resource']['meta']['lastUpdated'];
            }
            if (element['resource']['contained']) {
                element['resource']['contained'].forEach(containedElement => {
                    delete containedElement['meta']['lastUpdated'];
                });
                // sort the list
                element['resource']['contained'] = element['resource']['contained'].sort(
                    (a, b) => `${a.resourceType}/${a.id}`.localeCompare(`${b.resourceType}/${b.id}`)
                );
            }
        }
    });
    expected.entry.forEach(element => {
        delete element['fullUrl'];
        if ('meta' in element['resource']) {
            delete element['resource']['meta']['lastUpdated'];
        }
        // element['resource']['meta']['versionId'] = '1';
        if ('$schema' in element) {
            delete element['$schema'];
        }
        if (element['resource']['contained']) {
            element['resource']['contained'].forEach(containedElement => {
                delete containedElement['meta']['lastUpdated'];
            });
            // sort the list
            element['resource']['contained'] = element['resource']['contained'].sort(
                (a, b) => `${a.resourceType}/${a.id}`.localeCompare(`${b.resourceType}/${b.id}`)
            );
        }
    });

    expect(body).toStrictEqual(expected);
}

/**
 * Asserts that response matches the status
 * @param {number} expectedStatusCode
 * @return {(function(*): void)|*}
 */
function assertStatusCode(expectedStatusCode) {
    return (resp) => {
        try {
            expect(resp.status).toBe(expectedStatusCode);
        } catch (e) {
            assertFail({
                    source: 'assertStatusCode',
                    message: `Status Code did not match: ${JSON.stringify(resp)}`,
                    args: {
                        expected: expectedStatusCode,
                        actual: resp.status,
                        responseBody: resp.body
                    },
                    error: e
                }
            );
        }
    };
}

/**
 * Asserts that response has OK status
 * @return {(function(*): void)|*}
 */
function assertStatusOk() {
    return assertStatusCode(200);
}

/**
 * Asserts that count of resources in the response matches
 * @param {number} count
 * @return {(function(*): void)|*}
 */
function assertResourceCount(count) {
    return (resp) => {
        try {
            expect(resp.status).toBe(200);
            expect(resp.body.length).toBe(count);
        } catch (e) {
            assertFail({
                    source: 'assertResourceCount',
                    message: `Resource count ${resp.body.length} != ${count}: ${JSON.stringify(resp.body)}`,
                    args: {
                        expected: count,
                        actual: resp.body.length,
                        responseBody: resp.body
                    },
                    error: e
                }
            );
        }
    };
}

/**
 * Asserts that merge is successfull
 * @param {Object[]|Object} checks
 * @return {(function(*): void)|*}
 */
function assertMerge(checks) {
    return (resp) => {
        try {
            expect(resp.status).toBe(200);
            const body = resp.body;
            if (Array.isArray(body)) {
                for (const bodyItemIndex in body) {
                    const bodyItem = body[`${bodyItemIndex}`];
                    const expectedItem = checks[`${bodyItemIndex}`];
                    expect(bodyItem).toEqual(expect.objectContaining(expectedItem));
                }
            } else {
                const firstCheck = Array.isArray(checks) ? checks[0] : checks;
                expect(body).toEqual(expect.objectContaining(firstCheck));
            }
            // assertMergeIsSuccessful(resp.body);
        } catch (e) {
            assertFail({
                    source: 'assertMerge',
                    message: `Merge failed: Expected: ${JSON.stringify(checks)}.  Actual: ${JSON.stringify(resp.body)}`,
                    args: {
                        expected: checks,
                        actual: resp.body,
                    },
                    error: e
                }
            );
        }
    };
}

/**
 * Asserts that merge is successfull
 * @param {Object|Object[]} expected
 * @param {(Resource) => Resource} [fnCleanResource]
 * @return {(function(*): void)|*}
 */
function assertResponse({expected, fnCleanResource}) {
    return (/** @type {import('http').ServerResponse} */ resp) => {
        if (Array.isArray(resp.body) && !Array.isArray(expected)) {
            expected = [expected];
        }
        if (!Array.isArray(resp.body) && Array.isArray(expected)) {
            expected = expected[0];
        }
        if (!Array.isArray(resp.body) && resp.body.resourceType === 'Bundle') {
            if (Array.isArray(expected)) { // make into a bundle if it is not
                expected = {
                    resourceType: 'Bundle',
                    type: 'searchset',
                    entry: expected.map(e => {
                        return {resource: e};
                    })
                };
            }
            assertCompareBundles({body: resp.body, expected, fnCleanResource});
            return;
        } else {
            if (Array.isArray(resp.body)) {
                resp.body.forEach(element => {
                    // clean out stuff that changes
                    if ('meta' in element) {
                        delete element['meta']['lastUpdated'];
                    }
                });
            } else {
                if ('meta' in resp.body) {
                    delete resp.body['meta']['lastUpdated'];
                }
                if (resp.body.resourceType) {
                    const operationOutcome = validateResource(resp.body, resp.body.resourceType, '');
                    if (operationOutcome && operationOutcome.statusCode === 400) {
                        assertFail({
                            source: 'assertResponse',
                            message: 'FHIR validation failed',
                            args: {
                                resourceType: resp.body.resourceType,
                                resource: resp.body,
                                operationOutcome: operationOutcome
                            }
                        });
                    }

                }
            }
            if (Array.isArray(expected)) {
                expected.forEach(element => {
                    // clean out stuff that changes
                    if ('meta' in element) {
                        delete element['meta']['lastUpdated'];
                    }
                });
            } else {
                if ('meta' in expected) {
                    delete expected['meta']['lastUpdated'];
                }
            }
        }
        expect(resp.body).toStrictEqual(expected);
    };
}


module.exports = {
    assertCompareBundles,
    assertMergeIsSuccessful,
    assertStatusCode,
    assertResourceCount,
    assertResponse,
    assertMerge,
    assertStatusOk
};
