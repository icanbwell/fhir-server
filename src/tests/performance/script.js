const request = require('superagent');

const token = '';

const getHeaders = () => {
    return {
        'Content-Type': 'application/fhir+json',
        Accept: 'application/fhir+json',
        Authorization: `Bearer ${token}`,
    };
};

async function main() {
    /**
     * Parser that reads chunks as they are received from server
     * @param {import('http').IncomingMessage} req
     * @param callback
     */
    function chunkParser(req, callback) {
        req.text = '';
        let text = '';
        req.setEncoding('utf8');
        let chunkNumber = 0;
        req.on('data', (chunk) => {
            req.text += chunk;
            text += chunk;
            chunkNumber++;
            console.log(`Received chunk ${chunkNumber} of length ${chunk.length}`);
        });
        req.on('end', () => {
            // Process the response data here
            callback(null, text);
        });
    }

    const url = 'http://localhost:3000/4_0_0/Practitioner?_format=text/csv&_count=10000';
    // const url = 'https://fhir.dev-ue1.bwell.zone/4_0_0/Practitioner?_format=text/csv&_count=10000';

    console.log(`Calling ${url}...`);
    // request.buffer['text/csv'] = true;
    // now check that we get the right record back
    const resp = await request
        .get(url)
        // .buffer(false)
        .set(getHeaders())
        // .buffer(false)
        .on('response', (res) => {
            // Handle response headers
            console.log('Response headers:', res.headers);
        })
        .on('error', (res) => {
            console.log('Response error:', res);
        })
        .parse(chunkParser);

    const lines = resp.text.split('\n');
    console.log('------ Last Line --------');
    console.log(lines.pop());
    console.log('------ End Last Line --------');
    console.log(`Finished with ${lines.length} lines.`);
}

main().catch(reason => {
    console.error(reason);
});
