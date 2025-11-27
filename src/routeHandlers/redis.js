/**
 * This route handler implements /redis
 */

let container;

/**
 * Handles Redis requests
 * @param {function (): SimpleContainer} fnGetContainer
 * @param {import('http').IncomingMessage} req
 * @param {import('express').Response} res
 * @return {Promise<void>}
 */
module.exports.handleRedisRequest = async (fnGetContainer, req, res) => {
    // Handle the Redis request here
    container = container || fnGetContainer();
    const redisClient = await container.redisClient;
    await redisClient.connectAsync();
    const lowercaseMethod = req.method.toLowerCase();
    let key, value;
    switch (lowercaseMethod) {
        case 'get':
            key = req.query.get('key');
            if (!key) {
                res.status(400).send('message: key query parameter is required');
                return;
            }
            value = await redisClient.get(key);
            res.json({key: key, value: value});
            break;
        case 'post':
            ({ key, value } = req.body);
            if (!key || !value) {
                res.status(400).send('message: key and value are required');
                return;
            }
            await redisClient.set(key, value);
            res.json({message: `Key ${key} set with value ${value}`});
            break;
        default:
            res.status(405).send('message: Method Not Allowed');
    }
};
