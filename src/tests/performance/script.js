const request = require('superagent');
const {ResponseChunkParser} = require('./responseChunkParser');

const token = 'eyJraWQiOiJvY2NDUk9WMkRzVjY1T0wrQzFIWmNuZmpDQ2dKOFV2UEh6ZzhnVVwvajZuaz0iLCJhbGciOiJSUzI1NiJ9.eyJzdWIiOiI0b3BvY2ltZGhwcG9rbjFrczBocGJvOWZrdiIsInRva2VuX3VzZSI6ImFjY2VzcyIsInNjb3BlIjoiYWNjZXNzXC8qLiogdXNlclwvKi4qIiwiYXV0aF90aW1lIjoxNjkwNDk2NTk0LCJpc3MiOiJodHRwczpcL1wvY29nbml0by1pZHAudXMtZWFzdC0xLmFtYXpvbmF3cy5jb21cL3VzLWVhc3QtMV95Vjd3dkQ0eEQiLCJleHAiOjE2OTA1MDAxOTQsImlhdCI6MTY5MDQ5NjU5NCwidmVyc2lvbiI6MiwianRpIjoiOTc5NWZiZWUtZjNkYS00ZWEwLWI2NTMtMDZiZWU0NjFkM2VmIiwiY2xpZW50X2lkIjoiNG9wb2NpbWRocHBva24xa3MwaHBibzlma3YifQ.Lq3cbps6ofUbnYLS947n-RV1xoGxOCrxQ-hVMTNW7uQMCt49uPQJHDshtCJRC4y2Uc8qRp-qYpZ7kf7da67bnEaTORaKXvAsYuNkhI73Cw2Dyv9RvWGB0AThgSx-me9P2vxhxBnDXBcez6pxmnBGQ_XYv_2d63-d2m_0-8ZgMCatpD3Y1OnhVaXDF7tdQRLxlSz4KkUpMd5rUPYY2f5FPfFI5a6XjPq7-r9loXnFO5uMod4X9ENnZz_oX_fYqXmF27NUdewONBQiObRJzfRFp7jW-kD89CE2A_D95r-44_WI0xFvsgHUBpudrP7SJH8JKdi8hYbrWFsPRWts5qbOIQ';

const accept = 'application/fhir+json';
// const accept = 'application/fhir+ndjson';

const getHeaders = () => {
    return {
        'Content-Type': 'application/fhir+json',
        Accept: accept,
        Authorization: `Bearer ${token}`,
    };
};

async function main() {

    // const url = 'https://fhir.client-sandbox.icanbwell.com/4_0_0/Person?_security=https://www.icanbwell.com/access%7Cbwell&address-postalcode=10001';
    const url = 'http://localhost:3000/4_0_0/Person?_security=https://www.icanbwell.com/access|bwell&address-postalcode=10001';
    // const url = 'http://localhost:3000/4_0_0/Practitioner?_format=text/csv&_count=10000';
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
        .parse(accept === 'application/fhir+json' ?
            new ResponseChunkParser().getFhirBundleParser() :
            new ResponseChunkParser().getTextParser()
        );

    const lines = resp.text.split('\n');
    console.log('------ Last Line --------');
    console.log(lines.pop());
    console.log('------ End Last Line --------');
    console.log(`Finished with ${lines.length} lines.`);
}

main().catch(reason => {
    console.error(reason);
});
