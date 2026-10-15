const { describe, test, expect } = require('@jest/globals');
const {
    assertTenantTagsWithinPersonTags,
    getAllowedTenantTagCodes
} = require('../../../utils/personSecurityContext');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');

const personTags = { owner: new Set(['bwell_demo']), access: new Set(['bwell_demo']) };
const binary = (security) => ({ resourceType: 'Binary', meta: { security } });
const owner = (code) => ({ system: SecurityTagSystem.owner, code });
const access = (code) => ({ system: SecurityTagSystem.access, code });

describe('assertTenantTagsWithinPersonTags', () => {
    test('allowed set is the Person codes plus bwell', () => {
        const allowed = getAllowedTenantTagCodes({ personTags });
        expect([...allowed.owner].sort()).toStrictEqual(['bwell', 'bwell_demo']);
        expect([...allowed.access].sort()).toStrictEqual(['bwell', 'bwell_demo']);
    });

    test.each([
        [[owner('bwell_demo'), access('bwell_demo')]],
        [[owner('bwell'), access('bwell')]],
        [[owner('bwell_demo')]]
    ])('accepts %j', (security) => {
        expect(() => assertTenantTagsWithinPersonTags({ resource: binary(security), personTags })).not.toThrow();
    });

    test.each([
        [[owner('other'), access('bwell_demo')]],
        [[owner('bwell_demo'), access('other')]],
        [[owner('bwell_demo'), access('bwell_demo'), access('other')]],
        [[access('bwell_demo')]],
        [[]]
    ])('rejects %j with 403', (security) => {
        expect(() => assertTenantTagsWithinPersonTags({ resource: binary(security), personTags }))
            .toThrow(expect.objectContaining({ statusCode: 403 }));
    });

    test('rejects when the Person could not be loaded', () => {
        expect(() => assertTenantTagsWithinPersonTags({ resource: binary([owner('bwell')]), personTags: null }))
            .toThrow(expect.objectContaining({ statusCode: 403 }));
    });

    test('rejects a resource without meta', () => {
        expect(() => assertTenantTagsWithinPersonTags({ resource: { resourceType: 'Binary' }, personTags }))
            .toThrow(expect.objectContaining({ statusCode: 403 }));
    });
});
