// A single leading '/' is a same-origin relative path. '//host/path' is protocol-relative
// (browsers treat it as an absolute URL to `host`), so it must be rejected explicitly --
// `startsWith('/')` alone does not exclude it.
function isSafeRelativeUrl (url) {
    return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//');
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

// Guard the browser-only entrypoint so this file can also be `require()`d in Node (for unit
// testing isSafeRelativeUrl) without jQuery/axios/window being defined.
if (typeof $ !== 'undefined') {
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
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { isSafeRelativeUrl };
}
