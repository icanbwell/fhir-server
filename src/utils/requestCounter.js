let requestCount = 0;

const incrementRequestCount = () => {
    requestCount++;
};

const decrementRequestCount = () => {
    requestCount--;
};

const getRequestCount = () => {
    return requestCount;
};

module.exports = {
    incrementRequestCount,
    decrementRequestCount,
    getRequestCount
};
