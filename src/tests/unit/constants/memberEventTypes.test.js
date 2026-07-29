'use strict';

const { describe, test, expect } = require('@jest/globals');
const { MemberEventTypes } = require('../../../dataLayer/providers/memberEventTypes');

describe('MemberEventTypes', () => {
    test('has MEMBER_ADDED constant', () => {
        expect(MemberEventTypes.MEMBER_ADDED).toBe('MEMBER_ADDED');
    });

    test('has MEMBER_REMOVED constant', () => {
        expect(MemberEventTypes.MEMBER_REMOVED).toBe('MEMBER_REMOVED');
    });

    test('constants are strings (for ClickHouse storage)', () => {
        expect(typeof MemberEventTypes.MEMBER_ADDED).toBe('string');
        expect(typeof MemberEventTypes.MEMBER_REMOVED).toBe('string');
    });
});
