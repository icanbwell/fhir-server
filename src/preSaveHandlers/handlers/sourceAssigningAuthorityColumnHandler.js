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
                sourceAssigningAuthorityCodes = resource.meta.security.filter(
                    s => s.system === SecurityTagSystem.owner).map(s => s.code);
                // add security tags
                for (const code of sourceAssigningAuthorityCodes) {
                    resource.meta.security.push(new Coding({
                        system: SecurityTagSystem.sourceAssigningAuthority,
                        code: code
                    }));
                }
            }
            if (sourceAssigningAuthorityCodes.length > 0) {
                resource._sourceAssigningAuthority = resource._sourceAssigningAuthority || {};
                // remove any tags that are don't have corresponding security tags
                for (const [tagName] of Object.entries(resource._sourceAssigningAuthority)) {
                    if (!sourceAssigningAuthorityCodes.includes(tagName)) {
                        delete resource._sourceAssigningAuthority[`${tagName}`];
                    }
                }
                // now add any new/updated tags
                for (const /** @type {string} **/ sourceAssigningAuthorityCode of sourceAssigningAuthorityCodes) {
                    if (resource._sourceAssigningAuthority[`${sourceAssigningAuthorityCode}`] !== 1) {
                        resource._sourceAssigningAuthority[`${sourceAssigningAuthorityCode}`] = 1;
                    }
                }
            }
        }

        return resource;
    }
}

module.exports = {
    SourceAssigningAuthorityColumnHandler
};
