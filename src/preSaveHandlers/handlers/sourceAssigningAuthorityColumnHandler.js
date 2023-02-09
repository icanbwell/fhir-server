const {PreSaveHandler} = require('./preSaveHandler');
const {SecurityTagSystem} = require('../../utils/securityTagSystem');
const Coding = require('../../fhir/classes/4_0_0/complex_types/coding');

class SourceAssigningAuthorityColumnHandler extends PreSaveHandler {
    async preSaveAsync({resource}) {
        if (resource.meta && resource.meta.security) {
            /**
             * @type {string[]}
             */
            let sourceAssigningAuthorityCodes = resource.meta.security.filter(
                s => s.system === SecurityTagSystem.sourceAssigningAuthority).map(s => s.code);
            // if no sourceAssigningAuthorityCodes so fall back to owner tags
            if (sourceAssigningAuthorityCodes.length === 0) {
                sourceAssigningAuthorityCodes = resource.meta.security
                    .filter(s => s.system === SecurityTagSystem.owner)
                    .map(s => s.code);
                sourceAssigningAuthorityCodes = Array.from(new Set(sourceAssigningAuthorityCodes));
                // add security tags
                for (const code of sourceAssigningAuthorityCodes) {
                    resource.meta.security.push(new Coding({
                        system: SecurityTagSystem.sourceAssigningAuthority,
                        code: code
                    }));
                }
            }
            sourceAssigningAuthorityCodes = Array.from(new Set(sourceAssigningAuthorityCodes));
            if (sourceAssigningAuthorityCodes.length > 0) {
                const sourceAssigningAuthorityCode = sourceAssigningAuthorityCodes[0];
                if (resource._sourceAssigningAuthority !== sourceAssigningAuthorityCode) {
                    resource._sourceAssigningAuthority = sourceAssigningAuthorityCode;
                }
            }
        }

        return resource;
    }
}

module.exports = {
    SourceAssigningAuthorityColumnHandler
};
