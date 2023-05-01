/**
 *
 * @param resource
 * @returns {*}
 */
const Coding = require('../../fhir/classes/4_0_0/complex_types/coding');
const { NPI_SYSTEM } = require('../runners/constants');
const { NPPES } = require('../runners/constants');
const { IdentifierSystem } = require('../../utils/identifierSystem');
const { PRACTITIONER_SOURCE_OWNER_MAP } = require('../runners/constants');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');

function fixPractitionerResource(resource, fixMultipleOwners) {
    let security = resource.meta.security || [];
    if (!security.length){
        console.log(`meta.security not present for resource _id: ${resource._id}. Skipping`);
        return resource;
    }
    const sourceAssigningAuthorities = security.filter(s => s.system === SecurityTagSystem.sourceAssigningAuthority);
    const source = resource.meta.source;
    let securityWithoutOriginalOwnersAndAuthority;
    if (fixMultipleOwners) {
        const owners = security.filter(s => s.system === SecurityTagSystem.owner);
        securityWithoutOriginalOwnersAndAuthority = security.filter(
            s => [SecurityTagSystem.owner, SecurityTagSystem.sourceAssigningAuthority].indexOf(s.system) === -1,
        );
        let newOwner;
        if (owners.length > 1) {
            newOwner = owners.find(o => o.code === NPPES);
            if (!newOwner && source && PRACTITIONER_SOURCE_OWNER_MAP[`${source}`]) {
                newOwner = owners.find(o => o.code === PRACTITIONER_SOURCE_OWNER_MAP[`${source}`]);
            }
        }
        if (newOwner) {
            securityWithoutOriginalOwnersAndAuthority.push(newOwner);
        }
    } else {
        securityWithoutOriginalOwnersAndAuthority = security.filter(
            s => SecurityTagSystem.sourceAssigningAuthority !== s.system,
        );
    }

    let newSourceAssigningAuthority = sourceAssigningAuthorities.find(s => s.code === NPPES);
    if (!newSourceAssigningAuthority) {
        const npiIdentifier = resource.identifier.find(i => i.system === NPI_SYSTEM);
        if (npiIdentifier && (npiIdentifier.value === resource.id || npiIdentifier.value === resource._sourceId)) {
            newSourceAssigningAuthority = new Coding({
                system: SecurityTagSystem.sourceAssigningAuthority,
                code: NPPES,
            });
        }
    }
    if (!newSourceAssigningAuthority && source && PRACTITIONER_SOURCE_OWNER_MAP[`${source}`]) {
        newSourceAssigningAuthority = sourceAssigningAuthorities.find(s => s.code === PRACTITIONER_SOURCE_OWNER_MAP[`${source}`]);
    }
    if (newSourceAssigningAuthority) {
        securityWithoutOriginalOwnersAndAuthority.push(newSourceAssigningAuthority);
        resource._sourceAssigningAuthority = newSourceAssigningAuthority.code;
    }
    resource.meta.security = securityWithoutOriginalOwnersAndAuthority;

    let identifier = resource.identifier || [];
    resource.identifier = identifier.filter(i => i.system !== IdentifierSystem.uuid);

    delete resource._uuid;

    return resource;
}

function fixResource(resource) {
    let security = resource.meta.security || [];
    if (!security.length){
        console.log(`meta.security not present for resource _id: ${resource._id}. Skipping`);
        return resource;
    }
    const sourceAssigningAuthorities = security.filter(s => s.system === SecurityTagSystem.sourceAssigningAuthority);
    const owners = security.filter(s => s.system === SecurityTagSystem.owner);
    let securityWithoutOriginalAuthority = security.filter(
        s => SecurityTagSystem.sourceAssigningAuthority !== s.system,
    );

    let newSourceAssigningAuthority = sourceAssigningAuthorities.length ? sourceAssigningAuthorities[0] : new Coding({
        system: SecurityTagSystem.sourceAssigningAuthority,
        code: owners[0],
    });
    securityWithoutOriginalAuthority.push(newSourceAssigningAuthority);
    resource._sourceAssigningAuthority = newSourceAssigningAuthority.code;
    resource.meta.security = securityWithoutOriginalAuthority;

    let identifier = resource.identifier || [];
    resource.identifier = identifier.filter(i => i.system !== IdentifierSystem.uuid);

    delete resource._uuid;

    return resource;
}

function fixMultipleAuthorities(resource, fixMultipleOwners) {
    const resourceFixFnMap = {
        'Practitioner': fixPractitionerResource,
    };
    return resourceFixFnMap[`${resource.resourceType}`] ? resourceFixFnMap[`${resource.resourceType}`](resource, fixMultipleOwners) : fixResource(resource);
}

module.exports = {
    fixMultipleAuthorities,
};
