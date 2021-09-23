module.exports.posts = [
    {
        id: '1'
    },
    {
        id: '2'
    }
];

module.exports.comments = [
    {
        id: '101',
        postId: '1',
        text: 'my comment'
    },
    {
        id: '102',
        postId: '1',
        text: 'my comment'
    },
    {
        id: '103',
        postId: '2',
        text: 'my comment'
    }
];

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
    }
];

module.exports.explanationOfBenefits = [
    {
        id: '101',
        status: 'active',
        use: 'usual',
        patient_reference: '1'
    }
];
