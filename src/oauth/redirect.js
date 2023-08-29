/* eslint-disable no-undef */
/* eslint-disable no-use-before-define */
// noinspection JSUnresolvedFunction
$(document).ready(function () {
  const parameters = getUrlVars();

  const authCode = parameters.get('code');
  // get token
  const tokenUrl = parameters.get('tokenUrl');

  const data = {
      grant_type: 'authorization_code',
      client_id: parameters.get('clientId'),
      code: authCode,
      redirect_uri: window.location.origin + '/authcallback',
  };

  const querystring = $.param(data);

  axios
      .request({
          url: tokenUrl,
          method: 'post',
          data: querystring,
          headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
          },
      })
      .then(function (res) {
          const accessToken = res.data.access_token;
          var jwt = parseJwt(accessToken);

          setCookie('jwt', accessToken, jwt.exp);

          const resourceUrl = decodeURIComponent(parameters.get('resourceUrl'));
          // console.log(resourceUrl);
          window.location.assign(resourceUrl);
      });
});

function getUrlVars() {
  const queryString = window.location.search;
  // console.log(queryString);
  const urlParams = new URLSearchParams(queryString);
  return urlParams;
}

function setCookie(cookie_name, cookie_value, expirationTime) {
  const d = new Date(expirationTime * 1000);
  let expires = 'expires=' + d.toUTCString();
  document.cookie =
      cookie_name + '=' + cookie_value + ';' + expires + ';path=/; samesite=strict';
}

function parseJwt(token) {
  var base64Url = token.split('.')[1];
  var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  var jsonPayload = decodeURIComponent(
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
