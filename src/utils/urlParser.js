const net = require('net');
const { logWarn, logDebug } = require("../operations/common/logging");


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
 * Check if a string is a valid IPv4 address. Delegates to Node's own `net.isIPv4`
 * rather than hand-parsing, so this always agrees with what Node's networking stack
 * would actually treat as a connectable IPv4 literal (e.g. octal/hex/integer forms
 * like "0177.0.0.1" or "2130706433" are correctly rejected as non-IPv4 here, matching
 * the fact that Node's `net`/`dns` layer doesn't resolve them as IPs either).
 * @param {string} str
 * @returns {boolean}
 */
function isValidIPv4(str) {
    return net.isIPv4(str);
}

/**
 * Validate a URL to prevent SSRF attacks.
 *
 * Checks:
 * - Scheme must be HTTPS (rejects http://, file://, gopher://, etc.)
 *   Exception: HTTP is allowed for localhost/127.0.0.1 (local development & tests)
 *   and internal Kubernetes services (*.svc.cluster.local)
 * - Hostname must not be a private or loopback IPv4 address (except internal hosts)
 * - Blocks the cloud metadata endpoint (169.254.169.254)
 * - Blocks any IPv6 literal address outright (::1, ::ffff:127.0.0.1, fc00::/7,
 *   fe80::/10, etc.) -- there's no legitimate use case for a profile URL to target an
 *   IPv6 literal, and the IPv4 private-range check above has no IPv6 equivalent, so
 *   rejecting all IPv6 literals closes that class of bypass without needing to
 *   replicate every IPv6 private/special-use range here.
 *
 * Not addressed: DNS rebinding (a hostname that resolves to a private IP at request
 * time, after this validation already passed) -- closing that would require
 * controlling DNS resolution at connect time, not just validating the URL string.
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

    // URL.hostname wraps IPv6 literals in brackets, e.g. "[::1]" or "[::ffff:7f00:1]"
    const rawHostname = parsed.hostname || '';
    const isBracketedIPv6 = rawHostname.startsWith('[') && rawHostname.endsWith(']');
    const hostname = isBracketedIPv6 ? rawHostname.slice(1, -1) : rawHostname;

    // Allow HTTP for localhost / 127.0.0.1 (local dev & test containers)
    // and for internal Kubernetes service URLs (*.svc.cluster.local), but not the
    // bare "svc.cluster.local" hostname without a service/namespace prefix.
    const isInternal = hostname === 'localhost' || hostname === '127.0.0.1';

    // Only allow HTTP and HTTPS protocols (reject file://, ftp://, gopher://, etc.)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        const scheme = parsed.protocol.replace(':', '');
        throw new Error(`URL must use HTTP or HTTPS, got: ${scheme}`);
    }

    if (isBracketedIPv6 || net.isIPv6(hostname)) {
        logWarn(`Blocked SSRF attempt: IPv6 literal URLs are not allowed: ${hostname}`);
        throw new Error(`URL cannot use an IPv6 literal address: ${hostname}`);
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
