const SecurityTagSystem = {
    access: 'https://www.icanbwell.com/access',
    owner: 'https://www.icanbwell.com/owner',
    vendor: 'https://www.icanbwell.com/vendor',
    sourceAssigningAuthority: 'https://www.icanbwell.com/sourceAssigningAuthority',
    connectionType: 'https://www.icanbwell.com/connectionType',
    // Stamped by the server on a patient-scoped Binary create: the creating member's person id
    // (clientFhirPersonId). See docs/superpowers/specs/2026-10-08-binary-patient-scoped-write-design.md
    clientPersonId: 'https://www.icanbwell.com/clientPersonId'
};

module.exports = {
    SecurityTagSystem
};
