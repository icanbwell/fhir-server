/**
 *
 * @param resource
 * @returns {*}
 */
const { IdentifierSystem } = require('../../utils/identifierSystem');
const { PRACTITIONER_SOURCE_OWNER_MAP } = require('../runners/constants');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');

function fixPractitionerResource(resource) {
    let security = resource.meta.security || [];
    const sourceAssigningAuthorities = security.filter(s => s.system === SecurityTagSystem.sourceAssigningAuthority);
    const owners = security.filter(s => s.system === SecurityTagSystem.owner);
    const securityWithoutOriginalOwnersAndAuthority = security.filter(
        s => [SecurityTagSystem.owner, SecurityTagSystem.sourceAssigningAuthority].indexOf(s.system) === -1,
    );
    const source = resource.meta.source;
    let newOwner;
    if (owners.length > 1) {
        newOwner = owners.find(o => o.code === 'nppes');
        if (!newOwner && source && PRACTITIONER_SOURCE_OWNER_MAP[`${source}`]) {
            newOwner = owners.find(o => o.code === PRACTITIONER_SOURCE_OWNER_MAP[`${source}`]);
        }
    }
    if (newOwner) {
        securityWithoutOriginalOwnersAndAuthority.push(newOwner);
        let newSourceAssigningAuthority;
        if (sourceAssigningAuthorities.length > 1) {
            newSourceAssigningAuthority = sourceAssigningAuthorities.find(o => o.code === newOwner.code);
        }
        if (newSourceAssigningAuthority) {
            securityWithoutOriginalOwnersAndAuthority.push(newSourceAssigningAuthority);
        }
        resource.meta.security = securityWithoutOriginalOwnersAndAuthority;

        let identifier = resource.identifier || [];
        resource.identifier = identifier.filter(i => i.system !== IdentifierSystem.uuid);

        delete resource._uuid;
        delete resource._sourceAssigningAuthority;
    }
    return resource;
}

function fixMultipleAuthorities(resource) {
    const resourceFixFnMap = {
        'Practitioner': fixPractitionerResource,
    };
    return resourceFixFnMap[`${resource.resourceType}`] ? resourceFixFnMap[`${resource.resourceType}`](resource) : resource;
}

module.exports = {
    fixMultipleAuthorities
};
