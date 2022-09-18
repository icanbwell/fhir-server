const yargs = require('yargs/yargs');
const {hideBin} = require('yargs/helpers');

/**
 * @classdesc parses command line parameters
 */
class CommandLineParser {
    /**
     * Parses the command line and gets the parameters as a Javascript Object
     * @returns {Object}
     */
    static parseCommandLine() {
        const argv = yargs(hideBin(process.argv)).argv;
        return argv;
    }
}

module.exports = {
    CommandLineParser
};
