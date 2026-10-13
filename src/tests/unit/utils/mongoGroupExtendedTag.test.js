const { describe, test, expect } = require('@jest/globals');
const {
    getExtendedGroupMemberWriteError,
    isExtendedGroup,
    rejectMemberOnExtendedGroupWrite,
    MONGO_GROUP_EXTENDED_FIELD
} = require('../../../utils/mongoGroupExtendedTag');

describe('getExtendedGroupMemberWriteError', () => {
    test('returns a too-costly error pointing to PATCH when the Group is extended and the body carries member', () => {
        const currentResource = { resourceType: 'Group', id: 'group-1', [MONGO_GROUP_EXTENDED_FIELD]: true };

        const error = getExtendedGroupMemberWriteError({ currentResource, hasMemberField: true });

        expect(error.statusCode).toBe(400);
        expect(error.message).toBe('Group group-1 members can only be changed with PATCH');
        expect(error.issue).toHaveLength(1);
        expect(error.issue[0].code).toBe('too-costly');
        expect(error.issue[0].diagnostics).toContain('PATCH');
        expect(error.issue[0].diagnostics).toContain('Use PATCH with JSON Patch to add members incrementally on /4_0_0/Group/group-1');
    });

    test('returns undefined for a metadata-only write to an extended Group', () => {
        const currentResource = { resourceType: 'Group', id: 'group-1', [MONGO_GROUP_EXTENDED_FIELD]: true };

        expect(getExtendedGroupMemberWriteError({ currentResource, hasMemberField: false })).toBeUndefined();
    });
});

describe('rejectMemberOnExtendedGroupWrite', () => {
    test('throws the too-costly error when the Group is extended and the submitted body carries member', () => {
        const currentResource = { resourceType: 'Group', id: 'group-1', [MONGO_GROUP_EXTENDED_FIELD]: true };

        expect(() => rejectMemberOnExtendedGroupWrite({ currentResource, hasMemberField: true }))
            .toThrow('Group group-1 members can only be changed with PATCH');
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
