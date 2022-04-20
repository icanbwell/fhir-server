const JSONStream = require('JSONStream');
const ndjson = require('ndjson');
const {pipeline} = require('stream');
const {ObjectChunker} = require('./objectChunker');

/**
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {import('mongodb').FindCursor<import('mongodb').WithId<Document>>} cursor
 * @returns {Promise<void>}
 */
async function streamData(req, res, cursor) {
    try {
        res.setHeader('Content-Encoding', 'gzip');
        const chunker = new ObjectChunker(10);
        // const chunker = new Transform({objectMode: true});
        if (req.headers.accept.includes('application/fhir+ndjson')) {
            await pipeline(
                cursor.stream(),
                chunker,
                ndjson.stringify(),
                res.type('application/fhir+ndjson'),
                err => {
                    if (err) {
                        console.error('Pipeline failed.', err);
                    } else {
                        console.log('Pipeline succeeded.');
                    }
                }
            );
        } else {
            // const openJson = '[\n';
            const openJson = '{"resourceType":"Bundle", "entry":[';
            const closeJson = ']}';
            // const closeJson = '\n]\n';
            await pipeline(
                cursor.stream({
                    transform(doc) {
                        return {
                            'resource': doc
                        };
                    }
                }),
                chunker,
                JSONStream.stringify(openJson, ',', closeJson),
                res.type('application/fhir+json'),
                err => {
                    if (err) {
                        console.error('Pipeline failed.', err);
                    } else {
                        console.log('Pipeline succeeded.');
                    }
                }
            );
        }
    } catch (e) {
        console.error(e);
        throw e;
    }
}

module.exports = {
    streamData: streamData
};
