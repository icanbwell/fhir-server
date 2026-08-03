const {
    describe,
    beforeEach,
    afterEach,
    test,
    expect
} = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    getTestContainer,
    createTestRequest
} = require('../../common');

describe('ScopesManager - getAccessCodesFromScopes Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('only matches scopes with the access/ prefix, not any scope merely starting with "access" (SEC-1580 F11)', async () => {
        await createTestRequest();
        const container = getTestContainer();
        const scopesManager = container.scopesManager;

        // a scope that starts with the literal characters "access" but is not
        // an access/<tenant>.<action> scope must not be treated as one
        const accessCodes = scopesManager.getAccessCodesFromScopes(
            'write', 'testUser', 'accessory/clientA.write user/*.write'
        );
        expect(accessCodes).toStrictEqual([]);
    });

    test('still matches a real access/ scope', async () => {
        await createTestRequest();
        const container = getTestContainer();
        const scopesManager = container.scopesManager;

        const accessCodes = scopesManager.getAccessCodesFromScopes(
            'write', 'testUser', 'access/clientA.write user/*.write'
        );
        expect(accessCodes).toStrictEqual(['clientA']);
    });
});
