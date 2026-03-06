const { logDebug, logWarn } = require('./fhirLogger');

/**
 * Check if an IP address string is a private or loopback address
 * @param {string} ip - IP address string (IPv4)
 * @returns {boolean}
 */
function isPrivateOrLoopbackIP(ip) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
        return false; // Invalid IP format
    }

    // Loopback: 127.0.0.0/8
    if (parts[0] === 127) {
        return true;
    }

    // Private IP ranges:
    // 10.0.0.0/8
    if (parts[0] === 10) {
        return true;
    }

    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
        return true;
    }

    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) {
        return true;
    }

    // Link-local: 169.254.0.0/16
    if (parts[0] === 169 && parts[1] === 254) {
        return true;
    }

    return false;
}

/**
 * Check if a string is a valid IPv4 address
 * @param {string} str
 * @returns {boolean}
 */
function isValidIPv4(str) {
    const parts = str.split('.');
    if (parts.length !== 4) {
        return false;
    }
    return parts.every(part => {
        const num = Number(part);
        return !isNaN(num) && num >= 0 && num <= 255 && part === String(num);
    });
}

/**
 * Validate a URL to prevent SSRF attacks.
 *
 * Checks:
 * - Scheme must be HTTPS (rejects http://, file://, gopher://, etc.)
 *   Exception: HTTP is allowed for localhost/127.0.0.1 (local development & tests)
 *   and internal Kubernetes services (*.svc.cluster.local)
 * - Hostname must not be a private or loopback IP (except internal hosts)
 * - Blocks the cloud metadata endpoint (169.254.169.254)
 *
 * @param {string} url - The URL to validate
 * @param {Object} options - Options object
 * @param {string} options.label - Label for error messages (default: "URL")
 * @throws {Error} If the URL fails validation
 */
function validateUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch (error) {
        throw new Error(`Not a valid URL: ${url}`);
    }

    const hostname = parsed.hostname || '';

    // Allow HTTP for localhost / 127.0.0.1 (local dev & test containers)
    // and for internal Kubernetes service URLs (*.svc.cluster.local), but not the
    // bare "svc.cluster.local" hostname without a service/namespace prefix.
    const isInternal = hostname === 'localhost' || hostname === '127.0.0.1';

    // Only allow HTTPS (with internal/localhost exception)
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isInternal)) {
        const scheme = parsed.protocol.replace(':', '');
        throw new Error(`URL must use HTTPS, got: ${scheme}`);
    }

    // Block private/loopback IPs and cloud metadata endpoints
    // (internal hosts are already allowed above, so skip the private-IP check for them)
    if (hostname && !isInternal) {
        if (isValidIPv4(hostname)) {
            if (isPrivateOrLoopbackIP(hostname) || hostname === '169.254.169.254') {
                logWarn(`Blocked SSRF attempt: cannot use private IP: ${hostname}`);
                throw new Error(`URL cannot use private IP: ${hostname}`);
            }
        } else {
            // Hostname is not an IP (DNS resolution will occur), which is acceptable
            logDebug(`URL uses hostname (not IP): ${hostname}`);
        }
    }
}

class UrlParser {
    /**
     * returns whether this value is a url
     * @param queryParameterValue
     * @return {boolean}
     */
    static isUrl (queryParameterValue) {
        return typeof queryParameterValue === 'string' &&
            (
                queryParameterValue.startsWith('http://') ||
                queryParameterValue.startsWith('https://') ||
                queryParameterValue.startsWith('ftp://')
            );
    }
}

module.exports = {
    UrlParser,
    validateUrl
};
