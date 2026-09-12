const {
    VERSIONS
    // fixed: src/constants.js exports no VERSIONS - this previously resolved to
    // undefined['4_0_1'] -> TypeError whenever base_version was absent from sanitized_args.
} = require('../utils/constants');

const service = require('./metadata.service.js');
const { FhirResponseUrlBuilder } = require('../../../utils/url/fhirResponseUrlBuilder');
/**
 * @name exports
 * @summary Metadata controller
 */

module.exports.getCapabilityStatement = ({
                                             profiles,
                                             security,
                                             statementGenerator
                                         }) => {
    return (req, res, next) => {
        // Use our service to generate the capability statement
        const {
            base_version: fhirVersion
        } = req.sanitized_args;
        return service.generateCapabilityStatement({
            fhirVersion: fhirVersion || VERSIONS['4_0_1'],
            profiles,
            security,
            statementGenerator
        }).then(statement => {
            // Machine-readable answer to "which base am I on" - now that /4_0_0 and an alias like
            // /fhir/r4 are both live, a client needs this to know which base path it is talking to.
            statement.implementation = statement.implementation || {};
            statement.implementation.url = FhirResponseUrlBuilder.fromRequest(req).build('');
            return res.status(200).json(statement);
        }).catch(err => next(err));
    };
};
