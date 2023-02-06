const deepEqual = require('fast-deep-equal');
const {compare} = require('fast-json-patch');
const {logWarn} = require('./logging');

module.exports.check_fhir_mismatch = (cleaned, patched) => {
    if (deepEqual(cleaned, patched) === false) {
        let diff = compare(cleaned, patched);
        logWarn(
            'Possible FHIR mismatch between incoming resource and updated resource',
            {
                user: 'user',
                args: {
                    resourceType: cleaned.resourceType,
                    id: cleaned.id,
                    diff: diff
                }
            }
        );
    }
};
