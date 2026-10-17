const excludedRequestHeaders = new Set([
    'connection',
    'content-length',
    'host',
    'transfer-encoding'
]);

const excludedResponseHeaders = new Set([
    'connection',
    'content-encoding',
    'content-length',
    'set-cookie',
    'transfer-encoding'
]);

module.exports = async function handler(request, response) {
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) {
        return response.status(503).json({message: 'The backend service is not configured.'});
    }

    const pathSegments = Array.isArray(request.query.path)
        ? request.query.path
        : [request.query.path].filter(Boolean);
    if (pathSegments.some(segment => segment === '.' || segment === '..' || segment.includes('/'))) {
        return response.status(400).json({message: 'Invalid API path.'});
    }
    const targetUrl = new URL(`/api/${pathSegments.map(encodeURIComponent).join('/')}`, backendUrl);
    targetUrl.search = new URL(request.url, 'http://localhost').search;

    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
        if (!excludedRequestHeaders.has(name) && typeof value === 'string') {
            headers.set(name, value);
        }
    }

    let body;
    if (!['GET', 'HEAD'].includes(request.method) && request.body !== undefined) {
        const contentType = headers.get('content-type') || '';
        if (Buffer.isBuffer(request.body) || typeof request.body === 'string') {
            body = request.body;
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
            body = new URLSearchParams(request.body).toString();
        } else {
            body = JSON.stringify(request.body);
        }
    }

    try {
        const upstream = await fetch(targetUrl, {
            method: request.method,
            headers,
            body,
            redirect: 'manual'
        });

        response.statusCode = upstream.status;
        response.setHeader('cache-control', 'no-store');
        for (const [name, value] of upstream.headers) {
            if (!excludedResponseHeaders.has(name)) {
                response.setHeader(name, value);
            }
        }

        const cookies = upstream.headers.getSetCookie?.();
        if (cookies?.length) {
            response.setHeader('set-cookie', cookies);
        }

        response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
        response.status(502).json({message: 'The backend service could not be reached.'});
    }
};
