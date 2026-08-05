// A single leading '/' is a same-origin relative path. '//host/path' is protocol-relative
// (browsers treat it as an absolute URL to `host`), so it must be rejected explicitly --
// `startsWith('/')` alone does not exclude it.
//
// Before checking, normalize the same way the browser's URL parser does: strip tab/newline/
// carriage-return characters (the WHATWG URL spec strips these wherever they appear in a
// URL) and convert backslashes to forward slashes (treated as path separators by http(s)
// URLs). Without this, a value like '/\evil.com' or '/\t/\evil.com' has only one leading '/'
// as written and passes a naive check, but resolves to the protocol-relative '//evil.com'
// once the browser normalizes it during navigation.
function isSafeRelativeUrl (url) {
    if (typeof url !== 'string') {
        return false;
    }
    const normalized = url.replace(/[\t\n\r]/g, '').replace(/\\/g, '/');
    return normalized.startsWith('/') && !normalized.startsWith('//');
}

function getUrlVars () {
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);
    return urlParams;
}

function setCookie (cookie_name, cookie_value, expirationTime) {
    const d = new Date(expirationTime * 1000);
    const expires = 'expires=' + d.toUTCString();
    document.cookie = cookie_name + '=' + cookie_value + ';' + expires + ';path=/; samesite=strict';
}

function parseJwt (token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
        window
            .atob(base64)
            .split('')
            .map(function (c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            })
            .join('')
    );

    return JSON.parse(jsonPayload);
}

// Wrapped in an IIFE (rather than a bare top-level `if`) so the browser-only guard below can
// use an early return -- this file is loaded both as a plain <script> and `require()`d in
// Node (for unit testing isSafeRelativeUrl), and a bare top-level `return` outside a function
// is a syntax error in the former.
(function () {
    if (typeof $ === 'undefined') {
        return;
    }

    // noinspection JSUnresolvedFunction
    $(document).ready(function () {
        const parameters = getUrlVars();

        const authCode = parameters.get('code');

        // Fetch the token endpoint + client id from the server rather than trusting a
        // `tokenUrl`/`clientId` query param: this page is served as a static asset, so
        // anyone can navigate to it directly with arbitrary query params. Sourcing these
        // two values from a same-origin, server-computed endpoint means the auth-code
        // exchange can never be redirected to an attacker-chosen destination.
        axios
            .get('/oauth/config')
            .then(function (configRes) {
                const tokenUrl = configRes.data.tokenUrl;

                const data = {
                    grant_type: 'authorization_code',
                    client_id: configRes.data.clientId,
                    code: authCode,
                    redirect_uri: window.location.origin + '/authcallback'
                };

                const querystring = $.param(data);

                return axios.request({
                    url: tokenUrl,
                    method: 'post',
                    data: querystring,
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                });
            })
            .then(function (res) {
                const accessToken = res.data.access_token;
                const jwt = parseJwt(accessToken);

                setCookie('jwt', accessToken, jwt.exp);

                const resourceUrl = decodeURIComponent(parameters.get('resourceUrl'));
                if (isSafeRelativeUrl(resourceUrl)) {
                    // URL is relative (and not protocol-relative), so redirect
                    window.location.assign(resourceUrl);
                } else {
                    throw new Error(`Url is not a relative ${resourceUrl}`);
                }
            });
    });
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { isSafeRelativeUrl };
}
