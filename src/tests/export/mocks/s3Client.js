const { S3Client } = require('../../../utils/s3Client');

class MockS3Client extends S3Client {
    async uploadAsync() {
        // do nothing
    }

    async createMultiPartUploadAsync() {
        // do nothing just return a string
        return 'test';
    }

    async uploadPartAsync() {
        // do nothing
    }

    async uploadEmptyFileAsync() {
        // do nothing
    }

    async completeMultiPartUploadAsync() {
        // do nothing
    }

    async abortMultiPartUploadAsync() {
        // do nothing
    }

    uploadInBatchAsync({ fileDataWithPath, batch }) {
        // for comparing the call to this function comparing buffer was not working with jest
        // hence comparing toHaveReturnedWith will be equal to comparing toHaveBeenCalledWith with following implementation
        let bufferToJsonData = fileDataWithPath.map((item) => {
            const jsonString = item.data.toString('utf-8');
            return {
                ...item,
                data: JSON.parse(jsonString)
            };
        });
        return {
            batch: batch,
            fileDataWithPath: bufferToJsonData
        };
    }
}

module.exports = { MockS3Client };
