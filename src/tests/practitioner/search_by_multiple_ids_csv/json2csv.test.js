const {describe, test} = require('@jest/globals');
const {Transform} = require('@json2csv/node');
const {flatten} = require('@json2csv/transforms');
const {createReadStream, createWriteStream} = require('fs');
const path = require('path');
// Constructing finished from stream

describe('JSON 2 CSV', () => {
    test('json2csv tests', async () => {
        const inputPath = path.resolve(__dirname, './fixtures/practitioner/practitioner.json');
        const outputPath = path.resolve(__dirname, './fixtures/practitioner/practitioner_out.json');
        const input = createReadStream(inputPath, {encoding: 'utf8'});
        const output = createWriteStream(outputPath, {encoding: 'utf8'});

        const opts = {
            transforms: [
                flatten({objects: true, arrays: true, separator: '_'}),
            ]
        };
        const parser = new Transform(opts);


        // You can also listen for events on the conversion and see how the header or the lines are coming out.
        parser
            .on('header', (header) => console.log(header))
            .on('line', (line) => console.log(line));

        const processor = input.pipe(parser).pipe(output);
        await new Promise(fulfill => processor.on('finish', fulfill));
    });
});
