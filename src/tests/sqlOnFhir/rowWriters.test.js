const { describe, test, expect } = require('@jest/globals');
const { Readable } = require('stream');
const { RowNdJsonWriter } = require('../../operations/sqlOnFhir/rowNdJsonWriter');
const { RowCsvWriter } = require('../../operations/sqlOnFhir/rowCsvWriter');

async function drain(rows, writer) {
    let out = '';
    const src = Readable.from(rows);
    writer.on('data', (c) => (out += c.toString()));
    src.pipe(writer);
    await new Promise((resolve, reject) => {
        writer.on('end', resolve);
        writer.on('error', reject);
    });
    return out;
}

describe('row writers', () => {
    test('NDJSON writes one JSON object per line', async () => {
        const out = await drain([{ id: 'p1' }, { id: 'p2' }], new RowNdJsonWriter());
        expect(out).toBe('{"id":"p1"}\n{"id":"p2"}\n');
    });

    test('CSV writes header then rows, JSON-encoding array cells', async () => {
        const out = await drain(
            [{ id: 'p1', given: ['Jane', 'Q'] }, { id: 'p2', given: [] }],
            new RowCsvWriter({ columns: ['id', 'given'] })
        );
        expect(out.split('\n')[0]).toBe('id,given');
        expect(out).toContain('p1,"[""Jane"",""Q""]"');
    });
});
