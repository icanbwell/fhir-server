const { S3Client } = require('../../../utils/s3Client');

class MockS3Client extends S3Client {
    uploadedData = {}

    uploadAsync({ filePath, data }) {
        this.uploadedData[filePath] = data.toString('utf-8');
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
            this.uploadedData[item.filePath] = jsonString;
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

    downloadInBatchAsync({ filePaths, batch }){
        let result = {}
        filePaths.forEach(path => {
            if(this.uploadedData[path]){
                result[path] = this.uploadedData[path];
            }
        });
        return result;
    }

    downloadAsync( filePaths ){
        if(this.uploadedData[filePaths]){
            return this.uploadedData[filePaths];
        }
        return null;
    }
}

module.exports = { MockS3Client };
