const request = require('superagent');
const {ResponseChunkParser} = require('./responseChunkParser');

const token = '';

const getHeaders = () => {
    return {
        'Content-Type': 'application/fhir+json',
        Accept: 'application/fhir+json',
        Authorization: `Bearer ${token}`,
    };
};

async function main() {

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
        .parse(new ResponseChunkParser().getFhirBundleParser());

    const lines = resp.text.split('\n');
    console.log('------ Last Line --------');
    console.log(lines.pop());
    console.log('------ End Last Line --------');
    console.log(`Finished with ${lines.length} lines.`);
}

main().catch(reason => {
    console.error(reason);
});
