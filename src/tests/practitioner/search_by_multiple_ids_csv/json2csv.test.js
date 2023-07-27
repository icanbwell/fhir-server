const {describe, test} = require('@jest/globals');
const {Transform} = require('@json2csv/node');
const {flatten} = require('@json2csv/transforms');
const {createReadStream, createWriteStream} = require('fs');
const path = require('path');
const {Readable} = require('stream');
const practitionerResource = require('./fixtures/practitioner/practitioner.json');
const practitionerResource2 = require('./fixtures/practitioner/practitioner2.json');
const practitionerResource3 = require('./fixtures/practitioner/practitioner3.json');
const {FhirResourceCsvWriter} = require('../../../operations/streaming/resourceWriters/fhirResourceCsvWriter');
const {fhirContentTypes} = require('../../../utils/contentTypes');
const Practitioner = require('../../../fhir/classes/4_0_0/resources/practitioner');


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
    test('json2csv tests with custom Transform', async () => {
        class MyTransform extends Transform {
            constructor() {
                const opts = {
                    transforms: [
                        flatten({objects: true, arrays: true, separator: '_'}),
                    ]
                };
                super(opts);
            }
        }

        const inputPath = path.resolve(__dirname, './fixtures/practitioner/practitioner.json');
        const outputPath = path.resolve(__dirname, './fixtures/practitioner/practitioner_out.json');
        const input = createReadStream(inputPath, {encoding: 'utf8'});
        const output = createWriteStream(outputPath, {encoding: 'utf8'});

        const parser = new MyTransform();
        const processor = input.pipe(parser).pipe(output);
        await new Promise(fulfill => processor.on('finish', fulfill));
    });
    test('json2csv tests with custom Transform in objectMode', async () => {
        class MyTransform extends Transform {
            constructor() {
                const opts = {
                    transforms: [
                        flatten({objects: true, arrays: true, separator: '_'}),
                    ]
                };
                const transformOpts = {
                    objectMode: true
                };
                const asyncOpts = {
                    objectMode: true
                };

                super(opts, transformOpts, asyncOpts);
            }

            _transform(chunk, encoding, done) {
                super._transform(chunk, encoding, done);
            }
        }

        const outputPath = path.resolve(__dirname, './fixtures/practitioner/practitioner_out.json');
        const output = createWriteStream(outputPath, {encoding: 'utf8'});

        const objectReadableStream = new Readable({
            objectMode: true,
            read() {
                // Push your object(s) to the stream
                this.push(practitionerResource);
                this.push(null); // Signal the end of the stream
            }
        });

        const parser = new MyTransform();
        const processor = objectReadableStream.pipe(parser).pipe(output);
        await new Promise(fulfill => processor.on('finish', fulfill));
    });
    test('json2csv tests with FhirCsvResoureWriter Transform in objectMode', async () => {
        const outputPath = path.resolve(__dirname, './fixtures/practitioner/practitioner_out.json');
        const output = createWriteStream(outputPath, {encoding: 'utf8'});

        const objectReadableStream = new Readable({
            objectMode: true,
            read() {
                // Push your object(s) to the stream
                this.push(new Practitioner(practitionerResource));
                this.push(null); // Signal the end of the stream
            }
        });

        /**
         * @type {AbortController}
         */
        const ac = new AbortController();

        const parser = new FhirResourceCsvWriter({
            signal: ac.signal,
            delimiter: ',',
            contentType: fhirContentTypes.csv
        });
        const processor = objectReadableStream.pipe(parser).pipe(output);
        await new Promise(fulfill => processor.on('finish', fulfill));
    });
    test('json2csv tests with multiple rows with FhirCsvResoureWriter Transform in objectMode', async () => {
        const outputPath = path.resolve(__dirname, './fixtures/practitioner/practitioner_out.json');
        const output = createWriteStream(outputPath, {encoding: 'utf8'});

        const objectReadableStream = new Readable({
            objectMode: true,
            read() {
                // Push your object(s) to the stream
                this.push(new Practitioner(practitionerResource));
                this.push(new Practitioner(practitionerResource2));
                this.push(new Practitioner(practitionerResource3));
                this.push(null); // Signal the end of the stream
            }
        });

        /**
         * @type {AbortController}
         */
        const ac = new AbortController();

        const parser = new FhirResourceCsvWriter({
            signal: ac.signal,
            delimiter: ',',
            contentType: fhirContentTypes.csv
        });
        const processor = objectReadableStream.pipe(parser).pipe(output);
        await new Promise(fulfill => processor.on('finish', fulfill));
    });
});
