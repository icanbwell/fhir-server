const { describe, test, expect } = require('@jest/globals');
const { jest: jestGlobal } = require('@jest/globals');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { ScopesManager } = require('../../../operations/security/scopesManager');
const { SecurityTagManager } = require('../../../operations/common/securityTagManager');
const { ConfigManager } = require('../../../utils/configManager');
const { PersonToPatientIdsExpander } = require('../../../utils/personToPatientIdsExpander');

function createStubInstance (RealClass, overrides = {}) {
    const instance = Object.create(RealClass.prototype);
    for (const [key, value] of Object.entries(overrides)) {
        Object.defineProperty(instance, key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true
        });
    }
    return instance;
}

describe('PersonToPatientIdsExpander — access gate letter for the Person lookup', () => {
    test('a non-patient-scoped caller resolves Persons with the r access codes', async () => {
        const getSecurityTagsFromScope = jestGlobal.fn().mockReturnValue(['tenantA']);
        const securityTagManager = createStubInstance(SecurityTagManager, {
            getSecurityTagsFromScope,
            getQueryWithSecurityTags: ({ query }) => query
        });
        const scopesManager = createStubInstance(ScopesManager, {
            hasPatientScope: () => false
        });
        const configManager = createStubInstance(ConfigManager, {
            useAccessIndex: false
        });
        const expander = new PersonToPatientIdsExpander({
            databaseQueryFactory: createStubInstance(DatabaseQueryFactory),
            scopesManager,
            securityTagManager,
            configManager
        });
        const databaseQueryManager = {
            findAsync: jestGlobal.fn().mockResolvedValue({
                hasNext: async () => false,
                nextObject: async () => null
            })
        };

        await expander.getPatientIdsFromPersonAsync({
            databaseQueryManager,
            personIds: ['person-1'],
            totalProcessedPersonIds: new Set(),
            level: 1,
            requestInfo: {
                user: 'user-1',
                scope: 'user/Person.r access/tenantA.r'
            }
        });

        expect(getSecurityTagsFromScope).toHaveBeenCalledWith(
            expect.objectContaining({ accessRequested: 'r' })
        );
    });
});
