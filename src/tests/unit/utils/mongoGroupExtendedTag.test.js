const { describe, test, expect } = require('@jest/globals');
const { rejectMemberOnExtendedGroupWrite, MONGO_GROUP_EXTENDED_FIELD } = require('../../../utils/mongoGroupExtendedTag');

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
