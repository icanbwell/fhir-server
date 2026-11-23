const { describe, test, expect } = require('@jest/globals');
const { MergeResultEntry } = require('../../../../../../operations/common/mergeResultEntry');
const { ImportResponder } = require('../../../../../../operations/writePipeline/operations/import/responder');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../../../../../operations/writePipeline/writeFailure');
const { WriteItem } = require('../../../../../../operations/writePipeline/writeItem');
const { WriteResponder } = require('../../../../../../operations/writePipeline/writeResponder');

const BYTE_OFFSET_URL = 'https://www.icanbwell.com/source-byte-offset';
const UUID_A = '00000000-0000-4000-8000-00000000000a';
const UUID_B = '00000000-0000-4000-8000-00000000000b';

/**
 * Builds the item for one synthetic Patient import line at `index`, read at `byteOffset`.
 */
const buildItem = ({ index, uuid = UUID_A, byteOffset = index * 100, forceUpdated = false, writeMode = 'insert' }) => {
    const item = new WriteItem({
        index,
        incoming: {
            resourceType: 'Patient',
            id: `patient-${uuid.slice(-1)}`,
            _uuid: uuid,
            _sourceAssigningAuthority: 'client-a'
        },
        importLine: { byteOffset, forceUpdated }
    });
    item.writeMode = writeMode;
    return item;
};

/**
 * Marks the item queued, as the write step does, and returns it.
 */
const queued = (item) => {
    item.markQueued();
    return item;
};

/**
 * Marks the item unchanged, as the no-op step does, and returns it.
 */
const unchanged = (item) => {
    item.markUnchanged();
    return item;
};

/**
 * Fails the item with a check failure with the given subject, issue code and text, and returns it.
 */
const failedByCheck = ({ item, subject, code, text }) => {
    item.fail({
        failure: new WriteFailure({
            stage: WRITE_FAILURE_STAGE.INCOMING_SCHEMA,
            subject,
            operationOutcome: {
                resourceType: 'OperationOutcome',
                issue: [{ severity: 'error', code, details: { text }, diagnostics: text }]
            }
        })
    });
    return item;
};

/**
 * Fails the item with a thrown error, and returns it.
 */
const failedByError = ({ item, subject, message }) => {
    item.fail({
        failure: new WriteFailure({ stage: WRITE_FAILURE_STAGE.BUILD, subject, error: new Error(message) })
    });
    return item;
};

/**
 * Strips the identity fields from the item's body and saves them on the item, as the prepare-body
 * step does, and returns the item.
 */
const stripped = (item) => {
    item.savedIdentity = {
        uuid: item.incoming._uuid,
        sourceAssigningAuthority: item.incoming._sourceAssigningAuthority
    };
    delete item.incoming._uuid;
    delete item.incoming._sourceAssigningAuthority;
    return item;
};

/**
 * Fails the item at the stage with a failure recorded on its body as it is, carrying the
 * OperationOutcome or the error given, and returns it.
 */
const failedAtStage = ({ item, stage, operationOutcome = null, error = null }) => {
    item.fail({
        failure: new WriteFailure({
            stage,
            subject: WriteFailure.subjectOf(item.incoming),
            operationOutcome,
            error
        })
    });
    return item;
};

/**
 * Builds the result of a write as the bulk inserter returns it.
 */
const flushResult = ({ uuid = UUID_A, created = false, updated = false, issue }) =>
    new MergeResultEntry({ id: 'patient-x', uuid, resourceType: 'Patient', created, updated, issue });

/**
 * Builds the failure subject of a Patient with the given uuid and source assigning authority.
 */
const subjectOf = (uuid, sourceAssigningAuthority = 'client-a') => ({
    id: `patient-${uuid.slice(-1)}`,
    uuid,
    sourceAssigningAuthority,
    resourceType: 'Patient'
});

/**
 * Returns the identity and flags an entry shows in the NDJSON output, for the patient with `uuid`.
 */
const patientShape = ({ uuid = UUID_A, created, updated }) => ({
    created,
    id: `patient-${uuid.slice(-1)}`,
    uuid,
    resourceType: 'Patient',
    updated,
    sourceAssigningAuthority: 'client-a'
});

/**
 * Returns the byte-offset extension an entry's issue carries.
 */
const offsetExtension = (valueInteger) => [{ url: BYTE_OFFSET_URL, valueInteger }];

describe('ImportResponder', () => {
    const responder = new ImportResponder();

    test('is a WriteResponder', () => {
        expect(responder).toBeInstanceOf(WriteResponder);
    });

    test('readAsync throws, because the import reader builds the items', async () => {
        await expect(responder.readAsync({})).rejects.toThrow('does not read a request');
    });

    test('recordMetrics does nothing', () => {
        expect(responder.recordMetrics({ results: [], requestInfo: {}, parsedArgs: {} })).toBeUndefined();
    });

    test('toResponse returns the results it is given', () => {
        const results = [flushResult({ created: true })];

        expect(responder.toResponse({ results })).toBe(results);
    });

    test.each([
        {
            name: 'a created line',
            build: () => ({
                items: [queued(buildItem({ index: 0 }))],
                executedResults: [flushResult({ created: true })]
            }),
            expected: [patientShape({ created: true, updated: false })],
            offsets: [0]
        },
        {
            name: 'an updated line',
            build: () => ({
                items: [queued(buildItem({ index: 0, writeMode: 'update', byteOffset: 7 }))],
                executedResults: [flushResult({ updated: true })]
            }),
            expected: [patientShape({ created: false, updated: true })],
            offsets: [7]
        },
        {
            name: 'two lines of one resource, the second a repeat in the same flush, both entries present',
            build: () => ({
                items: [
                    queued(buildItem({ index: 0, byteOffset: 0 })),
                    queued(buildItem({ index: 1, byteOffset: 90, forceUpdated: true }))
                ],
                executedResults: [flushResult({ created: true }), flushResult({ updated: true })]
            }),
            expected: [
                patientShape({ created: true, updated: false }),
                patientShape({ created: false, updated: true })
            ],
            offsets: [0, 90]
        },
        {
            name: 'a repeat line when the flush returned one result for the resource',
            build: () => ({
                items: [
                    queued(buildItem({ index: 0, byteOffset: 0 })),
                    queued(buildItem({ index: 1, byteOffset: 90, forceUpdated: true }))
                ],
                executedResults: [flushResult({ created: true })]
            }),
            expected: [
                patientShape({ created: true, updated: false }),
                patientShape({ created: false, updated: true })
            ],
            offsets: [0, 90]
        },
        {
            name: 'both lines of one resource as failed when the flush returned one result with an error for it',
            build: () => ({
                items: [
                    queued(buildItem({ index: 0, byteOffset: 0 })),
                    queued(buildItem({ index: 1, byteOffset: 90, forceUpdated: true }))
                ],
                executedResults: [
                    flushResult({
                        issue: { severity: 'error', code: 'exception', details: { text: 'write rejected' } }
                    })
                ]
            }),
            expected: [0, 90].map((byteOffset) => ({
                ...patientShape({ created: false, updated: false }),
                issue: {
                    severity: 'error',
                    code: 'exception',
                    details: { text: 'write rejected' },
                    extension: offsetExtension(byteOffset)
                },
                operationOutcome: {
                    resourceType: 'OperationOutcome',
                    issue: [{
                        severity: 'error',
                        code: 'exception',
                        details: { text: 'write rejected' },
                        extension: offsetExtension(byteOffset)
                    }]
                }
            })),
            offsets: [0, 90]
        },
        {
            name: 'an unchanged line, which is neither created nor updated',
            build: () => ({ items: [unchanged(buildItem({ index: 0, byteOffset: 4 }))], executedResults: [] }),
            expected: [patientShape({ created: false, updated: false })],
            offsets: [4]
        },
        {
            name: 'a line that failed validation, with its issue and byte-offset extension',
            build: () => ({
                items: [
                    failedByCheck({
                        item: buildItem({ index: 0, byteOffset: 57 }),
                        subject: subjectOf(UUID_A),
                        code: 'invalid',
                        text: 'name is not valid'
                    })
                ],
                executedResults: []
            }),
            expected: [
                {
                    ...patientShape({ created: false, updated: false }),
                    issue: {
                        severity: 'error',
                        code: 'invalid',
                        details: { text: 'name is not valid' },
                        diagnostics: 'name is not valid',
                        extension: offsetExtension(57)
                    },
                    operationOutcome: {
                        resourceType: 'OperationOutcome',
                        issue: [{
                            severity: 'error',
                            code: 'invalid',
                            details: { text: 'name is not valid' },
                            diagnostics: 'name is not valid',
                            extension: offsetExtension(57)
                        }]
                    }
                }
            ],
            offsets: [57]
        },
        {
            name: 'a forbidden line, which keeps its uuid and source assigning authority',
            build: () => ({
                items: [
                    failedByCheck({
                        item: buildItem({ index: 0, byteOffset: 0 }),
                        subject: subjectOf(UUID_A),
                        code: 'forbidden',
                        text: 'user import-user does not have access to [Patient]'
                    })
                ],
                executedResults: []
            }),
            expected: [
                expect.objectContaining({
                    ...patientShape({ created: false, updated: false }),
                    issue: expect.objectContaining({ code: 'forbidden', extension: offsetExtension(0) })
                })
            ],
            offsets: [0]
        },
        {
            name: 'a forbidden line with no source assigning authority, which does not gain one',
            build: () => ({
                items: [
                    failedByCheck({
                        item: buildItem({ index: 0, byteOffset: 0 }),
                        subject: { id: UUID_A, uuid: UUID_A, sourceAssigningAuthority: undefined, resourceType: 'Patient' },
                        code: 'forbidden',
                        text: 'user import-user has no access to resource Patient'
                    })
                ],
                executedResults: []
            }),
            expected: [
                {
                    created: false,
                    id: UUID_A,
                    uuid: UUID_A,
                    resourceType: 'Patient',
                    updated: false,
                    issue: expect.objectContaining({ code: 'forbidden' }),
                    operationOutcome: expect.objectContaining({ resourceType: 'OperationOutcome' })
                }
            ],
            offsets: [0]
        },
        {
            name: 'a line whose step threw, with the merge code\'s thrown-error entry and no byte offset',
            build: () => ({
                items: [
                    failedByError({
                        item: buildItem({ index: 0, byteOffset: 33 }),
                        subject: subjectOf(UUID_A),
                        message: 'merge went wrong'
                    })
                ],
                executedResults: []
            }),
            expected: [
                {
                    ...patientShape({ created: false, updated: false }),
                    issue: {
                        severity: 'error',
                        code: 'exception',
                        details: { text: `Error merging: ${JSON.stringify(buildItem({ index: 0 }).incoming)}` },
                        diagnostics: 'Error: merge went wrong',
                        expression: ['Patient/patient-a']
                    },
                    operationOutcome: expect.objectContaining({ resourceType: 'OperationOutcome' })
                }
            ],
            offsets: [undefined]
        },
        {
            name: 'a line that failed the pipe-in-id check on its stripped body, with the reader\'s identity and the pre-merge error entry',
            build: () => ({
                items: [
                    failedAtStage({
                        item: stripped(buildItem({ index: 0, byteOffset: 44 })),
                        stage: WRITE_FAILURE_STAGE.IDENTITY,
                        error: new Error('Pipe | is not allowed in id field')
                    })
                ],
                executedResults: []
            }),
            expected: [
                {
                    ...patientShape({ created: false, updated: false }),
                    issue: {
                        severity: 'error',
                        code: 'exception',
                        details: { text: 'Pipe | is not allowed in id field' },
                        diagnostics: 'Pipe | is not allowed in id field',
                        expression: ['Patient'],
                        extension: offsetExtension(44)
                    },
                    operationOutcome: {
                        resourceType: 'OperationOutcome',
                        issue: [{
                            severity: 'error',
                            code: 'exception',
                            details: { text: 'Pipe | is not allowed in id field' },
                            diagnostics: 'Pipe | is not allowed in id field',
                            expression: ['Patient'],
                            extension: offsetExtension(44)
                        }]
                    }
                }
            ],
            offsets: [44]
        },
        {
            name: 'a line that failed the size check on its stripped body, with the reader\'s identity',
            build: () => ({
                items: [
                    failedAtStage({
                        item: stripped(buildItem({ index: 0, byteOffset: 8 })),
                        stage: WRITE_FAILURE_STAGE.SIZE,
                        operationOutcome: {
                            resourceType: 'OperationOutcome',
                            issue: [{
                                severity: 'error',
                                code: 'too-long',
                                details: { text: 'Payload size too large.' }
                            }]
                        }
                    })
                ],
                executedResults: []
            }),
            expected: [
                {
                    ...patientShape({ created: false, updated: false }),
                    issue: {
                        severity: 'error',
                        code: 'too-long',
                        details: { text: 'Payload size too large.' },
                        extension: offsetExtension(8)
                    },
                    operationOutcome: {
                        resourceType: 'OperationOutcome',
                        issue: [{
                            severity: 'error',
                            code: 'too-long',
                            details: { text: 'Payload size too large.' },
                            extension: offsetExtension(8)
                        }]
                    }
                }
            ],
            offsets: [8]
        },
        {
            name: 'a line that failed an access check with no source assigning authority, which keeps none although its body was stripped earlier',
            build: () => {
                const item = stripped(buildItem({ index: 0, byteOffset: 0 }));
                item.incoming._uuid = UUID_A;
                return {
                    items: [
                        failedAtStage({
                            item,
                            stage: WRITE_FAILURE_STAGE.ACCESS,
                            operationOutcome: {
                                resourceType: 'OperationOutcome',
                                issue: [{
                                    severity: 'error',
                                    code: 'forbidden',
                                    details: { text: 'no access' }
                                }]
                            }
                        })
                    ],
                    executedResults: []
                };
            },
            expected: [
                {
                    created: false,
                    id: 'patient-a',
                    uuid: UUID_A,
                    resourceType: 'Patient',
                    updated: false,
                    issue: expect.objectContaining({ code: 'forbidden', extension: offsetExtension(0) }),
                    operationOutcome: expect.objectContaining({ resourceType: 'OperationOutcome' })
                }
            ],
            offsets: [0]
        },
        {
            name: 'a line whose flush result carries an error, reported as failed with its byte offset',
            build: () => ({
                items: [queued(buildItem({ index: 0, byteOffset: 12 }))],
                executedResults: [
                    flushResult({
                        issue: { severity: 'error', code: 'exception', details: { text: 'write rejected' } }
                    })
                ]
            }),
            expected: [
                {
                    ...patientShape({ created: false, updated: false }),
                    issue: {
                        severity: 'error',
                        code: 'exception',
                        details: { text: 'write rejected' },
                        extension: offsetExtension(12)
                    },
                    operationOutcome: {
                        resourceType: 'OperationOutcome',
                        issue: [{
                            severity: 'error',
                            code: 'exception',
                            details: { text: 'write rejected' },
                            extension: offsetExtension(12)
                        }]
                    }
                }
            ],
            offsets: [12]
        },
        {
            name: 'a flush error on the second of two lines of one resource, the first having succeeded',
            build: () => ({
                items: [
                    queued(buildItem({ index: 0, byteOffset: 0 })),
                    queued(buildItem({ index: 1, byteOffset: 90, forceUpdated: true }))
                ],
                executedResults: [
                    flushResult({ created: true }),
                    flushResult({
                        issue: { severity: 'error', code: 'exception', details: { text: 'write rejected' } }
                    })
                ]
            }),
            expected: [
                patientShape({ created: true, updated: false }),
                {
                    ...patientShape({ created: false, updated: false }),
                    issue: {
                        severity: 'error',
                        code: 'exception',
                        details: { text: 'write rejected' },
                        extension: offsetExtension(90)
                    },
                    operationOutcome: {
                        resourceType: 'OperationOutcome',
                        issue: [{
                            severity: 'error',
                            code: 'exception',
                            details: { text: 'write rejected' },
                            extension: offsetExtension(90)
                        }]
                    }
                }
            ],
            offsets: [0, 90]
        },
        {
            name: 'flush results for one resource and none for another, which is reported by its write mode',
            build: () => ({
                items: [
                    queued(buildItem({ index: 0, uuid: UUID_A, byteOffset: 0 })),
                    queued(buildItem({ index: 1, uuid: UUID_B, byteOffset: 50, writeMode: 'update' }))
                ],
                executedResults: [
                    flushResult({
                        uuid: UUID_A,
                        issue: { severity: 'error', code: 'exception', details: { text: 'write rejected' } }
                    })
                ]
            }),
            expected: [
                expect.objectContaining({
                    ...patientShape({ uuid: UUID_A, created: false, updated: false }),
                    issue: expect.objectContaining({ details: { text: 'write rejected' } }),
                    operationOutcome: expect.objectContaining({ resourceType: 'OperationOutcome' })
                }),
                patientShape({ uuid: UUID_B, created: false, updated: true })
            ],
            offsets: [0, 50]
        }
    ])('results gives $name', ({ build, expected, offsets }) => {
        const { items, executedResults } = build();

        const results = responder.results({ items, requestErrors: [], executedResults });

        expect(results.map((entry) => entry.toJSON())).toStrictEqual(expected);
        expect(results.map((entry) => entry.sourceByteOffset)).toStrictEqual(offsets);
    });

    /**
     * The entry kind each failure stage gives a thrown error: `beforeMerge` for the checks the old
     * worker ran before it called the merge code (`MergeResultEntry.createFromError` with the byte
     * offset), `merge` for every later stage (the merge code's thrown-error entry, no byte offset).
     */
    const ENTRY_KIND_BY_STAGE = {
        [WRITE_FAILURE_STAGE.STRUCTURE]: 'beforeMerge',
        [WRITE_FAILURE_STAGE.SCOPE]: 'beforeMerge',
        [WRITE_FAILURE_STAGE.SIZE]: 'beforeMerge',
        [WRITE_FAILURE_STAGE.IDENTITY]: 'beforeMerge',
        [WRITE_FAILURE_STAGE.INCOMING_SCHEMA]: 'beforeMerge',
        [WRITE_FAILURE_STAGE.INCOMING_META]: 'beforeMerge',
        [WRITE_FAILURE_STAGE.ACCESS]: 'beforeMerge',
        [WRITE_FAILURE_STAGE.LOOKUP]: 'merge',
        [WRITE_FAILURE_STAGE.STORED_VALIDATION]: 'merge',
        [WRITE_FAILURE_STAGE.BUILD]: 'merge',
        [WRITE_FAILURE_STAGE.RESULT_VALIDATION]: 'merge',
        [WRITE_FAILURE_STAGE.ATTACHMENTS]: 'merge',
        [WRITE_FAILURE_STAGE.WRITE]: 'merge'
    };

    test('every failure stage has an entry kind', () => {
        expect(Object.keys(ENTRY_KIND_BY_STAGE).sort()).toStrictEqual(Object.values(WRITE_FAILURE_STAGE).sort());
    });

    test.each(Object.entries(ENTRY_KIND_BY_STAGE).map(([stage, kind]) => ({ stage, kind })))(
        'a thrown error at the $stage stage gets the $kind entry',
        ({ stage, kind }) => {
            const item = failedAtStage({
                item: buildItem({ index: 0, byteOffset: 33 }),
                stage,
                error: new Error('synthetic step failure')
            });
            const body = { ...item.incoming };

            const [entry] = responder.results({ items: [item], executedResults: [] });

            const expectedEntry = kind === 'beforeMerge'
                ? MergeResultEntry.createFromError({
                    error: new Error('synthetic step failure'),
                    resource: body,
                    sourceByteOffset: 33
                })
                : MergeResultEntry.createFromMergeException({
                    error: new Error('synthetic step failure'),
                    resource: body,
                    resourceType: 'Patient'
                });
            expect(entry.toJSON()).toStrictEqual(expectedEntry.toJSON());
            expect(entry.sourceByteOffset).toBe(kind === 'beforeMerge' ? 33 : undefined);
            expect(entry.issue.extension).toStrictEqual(
                kind === 'beforeMerge' ? offsetExtension(33) : undefined
            );
        }
    );

    test('results gives one entry per item in item order, whatever order the items are given in', () => {
        const items = [
            queued(buildItem({ index: 2, uuid: UUID_B })),
            unchanged(buildItem({ index: 0 })),
            failedByCheck({
                item: buildItem({ index: 1, uuid: UUID_B }),
                subject: subjectOf(UUID_B),
                code: 'invalid',
                text: 'bad'
            })
        ];

        const results = responder.results({
            items,
            requestErrors: [],
            executedResults: [flushResult({ uuid: UUID_B, created: true })]
        });

        expect(results.map((entry) => entry.sourceByteOffset)).toStrictEqual([0, 100, 200]);
        expect(results.map((entry) => [entry.created, entry.updated, Boolean(entry.issue)])).toStrictEqual([
            [false, false, false],
            [false, false, true],
            [true, false, false]
        ]);
    });

    test('failureResults gives the entries of the failed items only, in item order', () => {
        const items = [
            queued(buildItem({ index: 0 })),
            failedByCheck({
                item: buildItem({ index: 2, uuid: UUID_B, byteOffset: 9 }),
                subject: subjectOf(UUID_B),
                code: 'invalid',
                text: 'second'
            }),
            failedByCheck({
                item: buildItem({ index: 1, uuid: UUID_A, byteOffset: 5 }),
                subject: subjectOf(UUID_A),
                code: 'invalid',
                text: 'first'
            })
        ];

        const results = responder.failureResults({ items, requestErrors: [] });

        expect(results.map((entry) => [entry._uuid, entry.sourceByteOffset])).toStrictEqual([
            [UUID_A, 5],
            [UUID_B, 9]
        ]);
    });

    test('a failed item has the same entry whether it is built before or after the flush', () => {
        const items = [
            failedByCheck({
                item: buildItem({ index: 0, byteOffset: 21 }),
                subject: subjectOf(UUID_A),
                code: 'invalid',
                text: 'bad'
            })
        ];

        const before = responder.failureResults({ items, requestErrors: [] });
        const after = responder.results({ items, requestErrors: [], executedResults: [] });

        expect(after.map((entry) => entry.toJSON())).toStrictEqual(before.map((entry) => entry.toJSON()));
        expect(after[0].issue.extension).toStrictEqual(offsetExtension(21));
    });
});
