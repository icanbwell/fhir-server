'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../middleware/fhir/utils/constants', () => ({
    VERSIONS: { '4_0_0': '4_0_0' }
}));

const profileMap = require('../../../../utils/data/profile.map');

describe('profile.map', () => {
    test('exports canonicalToOriginalUrlMap', () => {
        expect(profileMap.canonicalToOriginalUrlMap).toBeDefined();
    });

    test('has entries for 4_0_0 version', () => {
        const map = profileMap.canonicalToOriginalUrlMap['4_0_0'];
        expect(map).toBeDefined();
        expect(typeof map).toBe('object');
    });

    test('AuditEvent profile exists', () => {
        const map = profileMap.canonicalToOriginalUrlMap['4_0_0'];
        expect(map.AuditEvent).toBeDefined();
    });

    test('profile URLs are valid URL strings', () => {
        const map = profileMap.canonicalToOriginalUrlMap['4_0_0'];
        for (const resourceType of Object.keys(map)) {
            for (const [canonical, original] of Object.entries(map[resourceType])) {
                expect(canonical).toMatch(/^http/);
                expect(original).toMatch(/^http/);
            }
        }
    });

    test('contains entries for multiple resource types', () => {
        const map = profileMap.canonicalToOriginalUrlMap['4_0_0'];
        const resourceTypes = Object.keys(map);
        expect(resourceTypes.length).toBeGreaterThan(3);
    });
});
