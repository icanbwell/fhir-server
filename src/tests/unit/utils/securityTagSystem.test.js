'use strict';

const { describe, test, expect } = require('@jest/globals');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');

describe('SecurityTagSystem', () => {
    test('has access key with correct URL', () => {
        expect(SecurityTagSystem.access).toBe('https://www.icanbwell.com/access');
    });

    test('has owner key with correct URL', () => {
        expect(SecurityTagSystem.owner).toBe('https://www.icanbwell.com/owner');
    });

    test('has vendor key with correct URL', () => {
        expect(SecurityTagSystem.vendor).toBe('https://www.icanbwell.com/vendor');
    });

    test('has sourceAssigningAuthority key with correct URL', () => {
        expect(SecurityTagSystem.sourceAssigningAuthority).toBe('https://www.icanbwell.com/sourceAssigningAuthority');
    });

    test('has connectionType key with correct URL', () => {
        expect(SecurityTagSystem.connectionType).toBe('https://www.icanbwell.com/connectionType');
    });

    test('has clientPersonId key with correct URL', () => {
        expect(SecurityTagSystem.clientPersonId).toBe('https://www.icanbwell.com/clientPersonId');
    });

    test('has exactly 6 keys', () => {
        expect(Object.keys(SecurityTagSystem)).toHaveLength(6);
    });

    test('contains all expected keys', () => {
        const expectedKeys = ['access', 'owner', 'vendor', 'sourceAssigningAuthority', 'connectionType', 'clientPersonId'];
        expect(Object.keys(SecurityTagSystem).sort()).toEqual(expectedKeys.sort());
    });
});
