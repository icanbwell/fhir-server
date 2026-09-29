const { FhirResourceWriterBase } = require('./fhirResourceWriterBase');
const { fhirContentTypes } = require('../../../utils/contentTypes');
const { ConfigManager } = require('../../../utils/configManager');
const { assertTypeEquals } = require('../../../utils/assertType');
const { logError } = require('../../common/logging');
const { RethrownError } = require('../../../utils/rethrownError');
const { captureException } = require('../../common/sentry');
const GroupMemberSerializer = require('../../../fhir/serializers/4_0_0/backbone_elements/groupMember');

class GroupMemberArrayWriter extends FhirResourceWriterBase {
    constructor ({ groupResourceJson, signal, highWaterMark, configManager, response }) {
        super({
            objectMode: true,
            contentType: fhirContentTypes.fhirJson,
            highWaterMark,
            response
        });
        this._groupResourceJson = groupResourceJson;
        this._signal = signal;
        this._first = true;
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    _shellPrefix () {
        const shellJson = JSON.stringify(this._groupResourceJson);
        return shellJson.slice(0, -1) + ',"member":[';
    }

    _transform (chunk, encoding, callback) {
        if (this._signal.aborted) {
            callback();
            return;
        }
        try {
            if (chunk !== null && chunk !== undefined && chunk.member) {
                const memberJson = JSON.stringify(GroupMemberSerializer.serialize(chunk.member));
                if (this._first) {
                    this._first = false;
                    this.push(this._shellPrefix() + memberJson, encoding);
                } else {
                    this.push(',' + memberJson, encoding);
                }
            }
            callback();
        } catch (e) {
            const error = new RethrownError({
                message: `GroupMemberArrayWriter _transform: error: ${e.message}`,
                error: e,
                args: { chunk }
            });
            logError(`GroupMemberArrayWriter _transform: error: ${e.message}`, {
                error,
                source: 'GroupMemberArrayWriter._transform'
            });
            captureException(error);
            callback();
        }
    }

    _flush (callback) {
        try {
            if (this._first) {
                this._first = false;
                this.push(this._shellPrefix());
            }
        } catch (e) {
            const error = new RethrownError({
                message: `GroupMemberArrayWriter _flush: error: ${e.message}`,
                error: e,
                args: {}
            });
            logError(`GroupMemberArrayWriter _flush: error: ${e.message}`, {
                error,
                source: 'GroupMemberArrayWriter._flush'
            });
            captureException(error);
        }
        this.push(']}');
        this.push(null);
        callback();
    }
}

module.exports = { GroupMemberArrayWriter };
