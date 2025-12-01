/**
 * This route handler implements /redis
 */


/**
 * Handles Redis requests
 * @param {SimpleContainer} container
 * @param {import('http').IncomingMessage} req
 * @param {import('express').Response} res
 * @return {Promise<void>}
 */
module.exports.handleRedisRequest = async (container, req, res) => {
    // Handle the Redis request here
    const redisClient = await container.redisClient;
    let redisConnected = await redisClient.connectAsync();
    if (!redisConnected) {
        res.status(500).json({ message: 'Unable to connect to Redis' });
        return;
    }
    const lowercaseMethod = req.method.toLowerCase();
    let key, value;
    switch (lowercaseMethod) {
        case 'get':
            key = req.query.key;
            if (!key) {
                res.status(400).json({message: 'key query parameter is required'});
                return;
            }
            value = await redisClient.get(key);
            res.json({key: key, value: value});
            break;
        case 'post':
            ({ key, value } = req.body);
            if (!key || !value) {
                res.status(400).json({message: 'key and value are required'});
                return;
            }
            await redisClient.set(key, value);
            res.json({message: `Key ${key} set with value ${value}`});
            break;
        default:
            res.status(405).json({message: 'Method Not Allowed'});
    }
};
