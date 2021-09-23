module.exports.patients = [
    {
        id: '1',
        name: [
            {
                use: 'active',
                family: 'Qureshi',
                given: [
                    'Imran'
                ]
            }
        ]
    },
    {
        id: '2',
        name: [
            {
                use: 'active',
                family: 'Jones',
                given: [
                    'Jim'
                ]
            }
        ]
    }
];

module.exports.explanationOfBenefits = [
    {
        id: '101',
        status: 'active',
        use: 'usual',
        patient_reference: '1'
    },
    {
        id: '102',
        status: 'active',
        use: 'usual',
        patient_reference: '2'
    },
    {
        id: '103',
        status: 'active',
        use: 'usual',
        patient_reference: '1'
    }
];
