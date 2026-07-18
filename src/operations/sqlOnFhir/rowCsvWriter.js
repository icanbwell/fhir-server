const { Transform } = require('@json2csv/node');

/**
 * String formatter that only quotes a cell when it actually contains the
 * quote character, the field separator, or a line break -- i.e. it matches
 * `@json2csv/formatters`' `stringQuoteOnlyIfNecessary` behavior without
 * pulling in `@json2csv/formatters` as an extra explicit dependency (it is
 * already a transitive dependency of `@json2csv/node`).
 *
 * @param {string} value
 * @returns {string}
 */
function quoteOnlyIfNecessary(value) {
    if (value.includes('"') || value.includes(',') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

/**
 * Transform stream that converts plain row objects (SQL-on-FHIR $run output
 * rows, NOT FHIR resources) into CSV bytes, wrapping `@json2csv/node`'s
 * Transform.
 *
 * The `columns` array fixes both the header line and the per-row column
 * order (D3). Array/object cell values are JSON-encoded into the cell as a
 * scalar string so `@json2csv` never tries to flatten/expand them; `null`
 * and `undefined` values are left as-is and render as an empty cell.
 */
class RowCsvWriter extends Transform {
    /**
     * @param {{ columns: string[] }} params ordered column names for header + field order
     */
    constructor({ columns }) {
        super(
            {
                fields: columns,
                formatters: { string: quoteOnlyIfNecessary, header: quoteOnlyIfNecessary }
            },
            {},
            { objectMode: true }
        );

        /**
         * @type {string[]}
         * @private
         */
        this._columns = columns;
    }

    _transform(row, encoding, done) {
        const encoded = {};
        for (const key of this._columns) {
            const value = row[key];
            encoded[key] = value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
        }
        return super._transform(encoded, encoding, done);
    }
}

module.exports = { RowCsvWriter };
