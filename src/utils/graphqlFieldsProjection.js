/**
 * This function updates any null, undefined, empty objects and empty arrays to 1
 * @param {Object} obj
 * @return {Object}
 */
const graphqlFieldsToMongoProjection = (obj) => {
    Object
        .entries(obj)
        .forEach(([k, v]) => {
            if (v && typeof v === 'object') {
                graphqlFieldsToMongoProjection(v);
            }
            if (v && typeof v === 'object' && !Object.keys(v).length || v === null || v === undefined) {
                obj[`${k}`] = 1;
            }
        });
    return obj;
};

module.exports = {
    graphqlFieldsToMongoProjection,
};
