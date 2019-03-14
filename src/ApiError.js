"use strict";

const ExtendableError = require('es6-error');
const _ = require('lodash');
const util = require('util');
const thr = require('throw');

class ApiError extends ExtendableError{
    constructor(status, code, message, ...messageParams) {
        super(util.format(message, ...messageParams));
        this.name = this.constructor.name;
        this.status = status;
        this.code = code;
        this.developerMessage = this.message;
        this.moreInfo = '';
    }
    
    write(res){
        return res.status(this.status).json(this);
    }
}

ApiError.BAD_REQUEST = function (message) {
    return new ApiError(400, 400, message);
};
ApiError.UNAUTHORIZED = new ApiError(401, 401, 'Authentication required.', 'Authentication with a valid API Key is required.');
ApiError.FORBIDDEN = new ApiError(403, 403, 'Sorry, you\'re not allowed to do that');
ApiError.NOT_FOUND = new ApiError(404, 404, 'The requested resource does not exist');
ApiError.INVALID_TOKEN = new ApiError(400, 10017, 'Invalid token');
ApiError.FROM_ERROR = function (error) {
    return (error instanceof ApiError) ? error : new ApiError(500, 500, error.message || 'error');
};
ApiError.assert = function(condition, error, ...errorParams){
     return condition || thr(error, ...errorParams);
};
ApiError.assertFound = _.partial(ApiError.assert, _, ApiError.NOT_FOUND);
ApiError.assertOrError = _.partial(ApiError.assert, _, ApiError);

module.exports = ApiError;
