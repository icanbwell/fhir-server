const { default: axios } = require("axios");
const { SecurityTagSystem } = require("./src/utils/securityTagSystem");
const { generateUUID } = require("./src/utils/uid.util");

const proaPatient1 = {
    id: generateUUID(),
    resourceType: 'Patient',
    meta: {
        source: 'test',
        security: [
            {
                system: SecurityTagSystem.owner,
                code: 'proa',
            },
            {
                system: SecurityTagSystem.connectionType,
                code: 'proa'
            }
        ]
    }
}

const proaPerson1 = {
    id: generateUUID(),
    resourceType: 'Person',
    meta: {
        source: 'test',
        security: [
            {
                system: SecurityTagSystem.owner,
                code: 'proa',
            }
        ]
    },
    link: [
        {
            target: {
                reference: `Patient/${proaPatient1.id}`
            }
        }
    ]
}

const proaPerson2 = {
    id: generateUUID(),
    resourceType: 'Person',
    meta: {
        source: 'test',
        security: [
            {
                system: SecurityTagSystem.owner,
                code: 'proa',
            }
        ]
    },
    link: [
        {
            target: {
                reference: `Patient/${proaPatient1.id}`
            }
        }
    ]
}

const clientPatient1 = {
    id: generateUUID(),
    resourceType: 'Patient',
    meta: {
        source: 'test',
        security: [
            {
                system: SecurityTagSystem.owner,
                code: 'client',
            }
        ]
    }
}

const clientPerson1 = {
    id: generateUUID(),
    resourceType: 'Person',
    meta: {
        source: 'test',
        security: [
            {
                system: SecurityTagSystem.owner,
                code: 'client',
            }
        ]
    },
    link: [
        {
            target: {
                reference: `Patient/${clientPatient1.id}`
            }
        }
    ]
}

const masterPatient1 = {
    id: generateUUID(),
    resourceType: 'Patient',
    meta: {
        source: 'test',
        security: [
            {
                system: SecurityTagSystem.owner,
                code: 'bwell',
            }
        ]
    }
}

const masterPerson1 = {
    id: generateUUID(),
    resourceType: 'Person',
    meta: {
        source: 'test',
        security: [
            {
                system: SecurityTagSystem.owner,
                code: 'bwell',
            }
        ]
    },
    link: [
        {
            target: {
                reference: `Patient/${masterPatient1.id}`
            }
        },
        {
            target: {
                reference: `Person/${proaPerson1.id}`
            }
        },
        {
            target: {
                reference: `Person/${proaPerson2.id}`
            }
        },
        {
            target: {
                reference: `Person/${clientPerson1.id}`
            }
        }
    ]
}

axios.post('http://localhost:3000/4_0_0/Person/$merge', [
    proaPatient1,
    proaPerson1,
    masterPerson1,
], { headers: { 'Content-Type': 'application/fhir+json' }}).then(res => {
    console.log(res.data);
});


