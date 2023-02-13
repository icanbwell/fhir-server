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
        // Parse command line arguments using yargs library
        // hideBin is used to modify process.argv array to exclude the name of script executable
        // argv property is accessed to get the final argument values
        return yargs(hideBin(process.argv)).argv;
    }
}

module.exports = {
    CommandLineParser
};
