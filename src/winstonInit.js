const {
    Container,
    format,
    transports
} = require('winston');
const { json, combine, timestamp } = format;
const { getImageVersion } = require('./utils/getImageVersion');

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
 * @description Default configuration for logger
 */
const defaultConfig = {
    level: process.env.LOGLEVEL ? process.env.LOGLEVEL.toLowerCase() : 'info',
    format: combine(
        timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
        json()
    ),
    defaultMeta: {
        logger: 'default',
        version: getImageVersion()
    },
    colorize: true,
    silent: (process.env.LOGLEVEL?.toLocaleLowerCase() === 'silent'),
    transports: [new transports.Console({ level: 'debug' })]
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
            logger.configure({ transports: defaultConfig.transports });
        }
    } else {
        container.add('default', defaultConfig);
    }
};

module.exports = {
    getLogger,
    initialize
};
