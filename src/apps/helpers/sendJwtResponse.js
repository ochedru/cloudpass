'use strict';

const url = require('url');

function addParamToUri(uri, paramName, paramValue) {
    //just replace the placeholder if it exists
    const placeHolder = '${' + paramName + '}';
    if (uri.includes(placeHolder)) {
        return uri.replace(placeHolder, paramValue);
    }
    //else, either add the param to existing params
    //or add a query string to the uri if no param exist
    const parsed = url.parse(uri);
    if (parsed.search) {
        parsed.search += '&' + paramName + '=' + paramValue;
    } else {
        parsed.search = '?' + paramName + '=' + paramValue;
    }
    return url.format(parsed);
}

module.exports = (res, uri) => jwtResponse => res.redirect(addParamToUri(uri, 'jwtResponse', jwtResponse));
