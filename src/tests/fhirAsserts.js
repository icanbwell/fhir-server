const {expect} = require('@jest/globals');
const {assertFail} = require('../utils/assertType');
const {validateResource} = require('../utils/validator.util');


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
        body.meta.tag.forEach((tag) => {
            if (tag['system'] === 'https://www.icanbwell.com/queryTime') {
                delete tag['display'];
            }
        });
    }
    expect(body.entry).not.toBeNull();
    expect(body.entry).not.toBeUndefined();
    body.entry.forEach((element) => {
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
        expected.meta.tag.forEach((tag) => {
            if (tag['system'] === 'https://www.icanbwell.com/queryTime') {
                delete tag['display'];
            }
        });
    }
    expected.entry.forEach((element) => {
        if (element['resource']['meta']) {
            delete element['resource']['meta']['lastUpdated'];
        }
        delete element['resource']['$schema'];
        if (fnCleanResource) {
            fnCleanResource(element['resource']);
        }
    });

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
            if (element['resource']['meta']) {
                delete element['resource']['meta']['lastUpdated'];
            }
            if (element['resource']['contained']) {
                element['resource']['contained'].forEach((containedElement) => {
                    delete containedElement['meta']['lastUpdated'];
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
        if ('meta' in element['resource']) {
            delete element['resource']['meta']['lastUpdated'];
        }
        // element['resource']['meta']['versionId'] = '1';
        if ('$schema' in element) {
            delete element['$schema'];
        }
        if (element['resource']['contained']) {
            element['resource']['contained'].forEach((containedElement) => {
                delete containedElement['meta']['lastUpdated'];
            });
            // sort the list
            element['resource']['contained'] = element['resource']['contained'].sort((a, b) =>
                `${a.resourceType}/${a.id}`.localeCompare(`${b.resourceType}/${b.id}`)
            );
        }
    });

    expect(body).toStrictEqual(expected);
}

/**
 *
 * @param {import('http').ServerResponse} resp
 * @param {number} expectedStatusCode
 */
function expectStatusCode(resp, expectedStatusCode) {
    try {
        expect(resp.status).toBe(expectedStatusCode);
    } catch (e) {
        assertFail({
            source: 'expectStatusCode',
            message: `Status Code did not match: ${resp.text}`,
            args: {
                expected: expectedStatusCode,
                actual: resp.status,
                responseBody: resp.body || resp.text,
            },
            error: e,
        });
    }
}

/**
 * Asserts that response has OK status
 * @return {(function(*): void)|*}
 */
function expectStatusOk(resp) {
    return expectStatusCode(resp, 200);
}

/**
 * expects resource count
 * @param {import('http').ServerResponse} resp
 * @param {number} count
 */
function expectResourceCount(resp, count) {
    try {
        expect(resp.status).toBe(200);
        expect(resp.body.length).toBe(count);
    } catch (e) {
        assertFail({
            source: 'expectResourceCount',
            message: `Resource count ${resp.body.length} != ${count}: ${JSON.stringify(
                resp.body
            )}`,
            args: {
                expected: count,
                actual: resp.body.length,
                responseBody: resp.body,
            },
            error: e,
        });
    }
}

/**
 * asserts
 * @param {import('http').ServerResponse} resp
 * @param {Object[]|Object} checks
 * @returns {void}
 */
function expectMergeResponse(resp, checks) {
    try {
        expect(resp.status).toBe(200);
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
        assertFail({
            source: 'assertMerge',
            message: `Merge failed: Expected: ${JSON.stringify(
                checks
            )}.  Actual: ${JSON.stringify(resp.body)}`,
            args: {
                expected: checks,
                actual: resp.body,
            },
            error: e,
        });
    }
}

/**
 * expect response
 * @param {import('http').ServerResponse} resp
 * @param {Object|Object[]} expected
 * @param {(Resource) => Resource} [fnCleanResource]
 * @returns {void}
 */
function expectResponse(resp, expected, fnCleanResource) {
    if (Array.isArray(resp.body) && !Array.isArray(expected)) {
        expected = [expected];
    }
    if (!Array.isArray(resp.body) && Array.isArray(expected)) {
        expected = expected[0];
    }
    if (!Array.isArray(resp.body) && resp.body.resourceType === 'Bundle') {
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
        assertCompareBundles({body: resp.body, expected, fnCleanResource});
        return;
    } else {
        if (Array.isArray(resp.body)) {
            resp.body.forEach((element) => {
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
}

module.exports = {
    expectStatusOk,
    expectMergeResponse,
    expectResponse,
    expectResourceCount,
    expectStatusCode
};
