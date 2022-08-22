/**
 * Implements the main function
 */
const {createServer} = require('./server');
const {createContainer} = require('./createContainer');

const main = async function () {
    await createServer(() => createContainer());
};

main().catch(reason => {
    console.error(JSON.stringify({message: `Top level error: ${reason}`}));
});
