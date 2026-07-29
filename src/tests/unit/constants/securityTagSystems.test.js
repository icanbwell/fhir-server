'use strict';

const { describe, test, expect } = require('@jest/globals');
const { SECURITY_TAG_SYSTEMS } = require('../../../constants/securityTagSystems');

describe('securityTagSystems', () => {
    test('ACCESS is the icanbwell access URL', () => {
        expect(SECURITY_TAG_SYSTEMS.ACCESS).toBe('https://www.icanbwell.com/access');
    });

    test('OWNER is the icanbwell owner URL', () => {
        expect(SECURITY_TAG_SYSTEMS.OWNER).toBe('https://www.icanbwell.com/owner');
    });

    test('all values are HTTPS URLs', () => {
        Object.values(SECURITY_TAG_SYSTEMS).forEach(url => {
            expect(url).toMatch(/^https:\/\//);
        });
    });
});
