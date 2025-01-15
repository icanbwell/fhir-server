let requestCount = 0;

const incrementRequestCount = () => {
    requestCount++;
};

const decrementRequestCount = () => {
    if (requestCount > 0) {
        requestCount--;
    }
};

const getRequestCount = () => {
    return requestCount;
};

module.exports = {
    incrementRequestCount,
    decrementRequestCount,
    getRequestCount
};
