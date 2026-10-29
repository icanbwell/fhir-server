const {
    getSearchParams
} = require('../utils/conformance.utils');

/**
 * @name exports
 * @summary Conformance statement
 */

module.exports = {
    resource: (baseVersion, key) => {
        const searchParams = getSearchParams(key, baseVersion);

        return {
            type: key,
            profile: {
                reference: `http://hl7.org/fhir/${key}.html`
            },
            conditionalDelete: 'not-supported',
            searchParam: searchParams
        };
    }
};
