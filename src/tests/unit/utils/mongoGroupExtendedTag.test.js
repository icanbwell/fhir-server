const { describe, test, expect } = require('@jest/globals');
const {
    rejectMemberOnExtendedGroupWrite,
    isExtendedGroup,
    MONGO_GROUP_EXTENDED_FIELD
} = require('../../../utils/mongoGroupExtendedTag');

describe('rejectMemberOnExtendedGroupWrite', () => {
    test('throws when the Group is extended and the submitted body carries member', () => {
        const currentResource = { resourceType: 'Group', id: 'group-1', [MONGO_GROUP_EXTENDED_FIELD]: true };

        expect(() => rejectMemberOnExtendedGroupWrite({ currentResource, hasMemberField: true }))
            .toThrow(/does not accept member changes via PUT or \$merge/);
    });

    test('does not throw when the Group is extended but the submitted body has no member field', () => {
        const currentResource = { resourceType: 'Group', id: 'group-1', [MONGO_GROUP_EXTENDED_FIELD]: true };

        expect(() => rejectMemberOnExtendedGroupWrite({ currentResource, hasMemberField: false })).not.toThrow();
    });

    test('does not throw for an embedded Group even if member is submitted', () => {
        const currentResource = { resourceType: 'Group', id: 'group-1' };

        expect(() => rejectMemberOnExtendedGroupWrite({ currentResource, hasMemberField: true })).not.toThrow();
    });

    test('does not throw for a non-Group resource', () => {
        const currentResource = { resourceType: 'Patient', id: 'patient-1', [MONGO_GROUP_EXTENDED_FIELD]: true };

        expect(() => rejectMemberOnExtendedGroupWrite({ currentResource, hasMemberField: true })).not.toThrow();
    });
});

describe('isExtendedGroup', () => {
    test('true when the _extended marker is exactly true', () => {
        expect(isExtendedGroup({ resourceType: 'Group', [MONGO_GROUP_EXTENDED_FIELD]: true })).toBe(true);
    });

    test('false for an embedded Group', () => {
        expect(isExtendedGroup({ resourceType: 'Group', member: [] })).toBe(false);
    });

    test('false for truthy non-boolean markers', () => {
        expect(isExtendedGroup({ [MONGO_GROUP_EXTENDED_FIELD]: 'true' })).toBe(false);
        expect(isExtendedGroup({ [MONGO_GROUP_EXTENDED_FIELD]: 1 })).toBe(false);
    });

    test('false for null and undefined', () => {
        expect(isExtendedGroup(null)).toBe(false);
        expect(isExtendedGroup(undefined)).toBe(false);
    });
});
