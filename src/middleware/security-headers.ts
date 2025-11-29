export function addSecurityHeaders(response: Response): Response {
    const headers = new Headers(response.headers);

    // Prevent MIME type sniffing
    headers.set('X-Content-Type-Options', 'nosniff');

    // Prevent clickjacking
    headers.set('X-Frame-Options', 'DENY');

    // Enable XSS protection
    headers.set('X-XSS-Protection', '1; mode=block');

    // Force HTTPS
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    // Content Security Policy
    headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");

    // Referrer policy
    headers.set('Referrer-Policy', 'no-referrer');

    // Permissions policy
    headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}
