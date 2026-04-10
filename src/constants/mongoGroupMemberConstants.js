/**
 * Constants for MongoDB Group Member implementation
 *
 * This module centralizes all collection/view names and configuration
 * used in the MongoDB Group member tracking system.
 */

module.exports = {
    // Collection and view names
    COLLECTIONS: {
        GROUP_MEMBER_EVENTS: 'Group_4_0_0_MemberEvent',
        GROUP_MEMBER_CURRENT: 'Group_4_0_0_MemberCurrent' // MongoDB standard view
    },

    // HTTP header for per-request activation (Express lowercases headers)
    HEADERS: {
        SUB_GROUP_MEMBER_REQUEST: 'subgroupmemberrequest'
    }
};
