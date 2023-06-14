/**
 * List of custom indexes to add.  (* means these indexes should be applied to all collections)
 * @description All options described here: https://www.mongodb.com/docs/manual/reference/method/db.collection.createIndex/
 */
module.exports = {
    customIndexes: {
        '*': [
            {
                keys: {
                    'id': 1
                },
                options: {
                    // unique: true,
                    name: 'id_1'
                },
                exclude: [
                    'AuditEvent_4_0_0'
                ]
            },
            {
                keys: {
                    'meta.lastUpdated': 1
                },
                options: {
                    name: 'meta.lastUpdated_1'
                },
                exclude: [
                    'AuditEvent_4_0_0'
                ]
            },
            {
                keys: {
                    'meta.security.system': 1,
                    'meta.security.code': 1
                },
                options: {
                    name: 'security.system_code_1'
                }
            }
        ]
    }
};
