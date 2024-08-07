const {
    Container,
    format,
    transports
} = require('winston');
const {json, combine, timestamp, simple} = format;
const {getImageVersion} = require('./utils/getImageVersion');


/**
 * Features
 * - make it easy to pass in logging config
 * - export multiple loggers
 * - export a default logger
 * - try not to be too much of a breaking change
 * - expose core container to allow for use in different implementations
 */

/**
 * @description Logging container that can be used to modify any loggers
 * availablie in the current application
 */
const container = new Container();


/**
 * @description Safe JSON formatter that limits the length of the JSON string
 * @type {*}
 */
const safeJson = format((info, opts) => {
    const toLimitedLengthJSON = (obj, maxLength) => {
        try {

            // Helper function to safely convert a key-value pair to JSON
            const toJSONString = (key, value) => {
                return `"${key}":${JSON.stringify(value)}`;
            };

            // Initialize the JSON string components
            let jsonString = '{';
            let isFirstProperty = true;

            for (const [key, value] of Object.entries(obj)) {
                // Convert the key-value pair to a JSON string
                const jsonEntry = toJSONString(key, value);

                // Check if adding this entry would exceed the max length
                if (jsonString.length + jsonEntry.length + 1 > maxLength) { // +1 for the closing brace
                    // noinspection BreakStatementJS
                    break; // Stop adding new properties
                }

                // Add a comma if it's not the first property
                if (isFirstProperty) {
                    isFirstProperty = false;
                } else {
                    jsonString += ',';
                }

                // Add the key-value pair to the JSON string
                jsonString += jsonEntry;
            }

            // Close the JSON string
            jsonString += '}';

            return jsonString;
        } catch (e) {
            return `${e}`;
        }
    };

    info["message"] = toLimitedLengthJSON(info, opts.maximumStringLength);
    return info;
});

/**
 * @description Default configuration for logger
 */
const defaultConfig = {
    level: process.env.LOGLEVEL ? process.env.LOGLEVEL.toLowerCase() : 'info',
    format: combine(
        timestamp({format: 'YYYY-MM-DDTHH:mm:ssZ'}),
        // json({maximumBreadth: 1, maximumDepth: 1}),
        safeJson({maximumStringLength: 1000})
        // json()
        // simple()
    ),
    defaultMeta: {
        logger: 'default',
        version: getImageVersion()
    },
    colorize: true,
    silent: (process.env.LOGLEVEL?.toLocaleLowerCase() === 'silent'),
    transports: [new transports.Console({level: 'debug'})],
    exitOnError: false
};

/**
 * @function getLogger
 * @description Retrieve a logger by name, same as container.getLogger except with a
 * default value applied to it
 * @param {String} name - Name of the logger
 * @param {Object} options - Options for the logger, this is also an alias for
 * adding a logger. Default value is defaultConfig
 * @return {import('winston').logger}
 */
const getLogger = (name = 'default', options = defaultConfig) => container.get(name, options);

/**
 * @function initialize
 * @description Initialize a default console logger
 */
const initialize = () => {
    // If we already have a logger by the provided default name, make sure it
    // has a console transport added. This can happen when someone accesses the
    // logger before calling initialize
    if (container.has('default')) {
        const logger = container.get('default'); // Only add the console logger if none is present

        if (logger.transports.length === 0) {
            logger.configure({transports: defaultConfig.transports});
        }
    } else {
        container.add('default', defaultConfig);
    }
};

module.exports = {
    getLogger,
    initialize
};
