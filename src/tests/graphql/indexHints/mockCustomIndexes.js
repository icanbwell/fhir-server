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
                    name: 'id_1'
                }
            },
            {
                keys: {
                    'uuid': 1
                },
                options: {
                    name: 'uuid'
                }
            }
        ]
    }
};
