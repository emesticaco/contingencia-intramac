const https = require('https');
const http = require('http');
const url = require('url');

const TARGET = 'https://intramac.intermacassist.com';
const targetParsed = url.parse(TARGET);

module.exports = async (req, res) => {
  // Strip /proxy prefix to get the actual path
  const rawPath = req.url.replace(/^\/proxy/, '') || '/';
  const fullPath = rawPath.startsWith('/') ? rawPath : '/' + rawPath;

  // Forward all original headers except host
  const forwardHeaders = { ...req.headers };
  forwardHeaders['host'] = targetParsed.hostname;
  delete forwardHeaders['connection'];
  delete forwardHeaders['transfer-encoding'];

  const options = {
    hostname: targetParsed.hostname,
    port: 443,
    path: fullPath,
    method: req.method,
    headers: forwardHeaders,
    timeout: 25000,
  };

  const protocol = targetParsed.protocol === 'https:' ? https : http;

  return new Promise((resolve) => {
    const proxy = protocol.request(options, (proxyRes) => {
      // Build clean response headers
      const responseHeaders = {};
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        const lower = key.toLowerCase();
        // Strip headers that block iframe embedding
        if (lower === 'x-frame-options') continue;
        if (lower === 'content-security-policy') continue;
        if (lower === 'content-security-policy-report-only') continue;
        // Rewrite absolute redirects to go through proxy
        if (lower === 'location') {
          const loc = value;
          if (loc.startsWith(TARGET)) {
            responseHeaders[key] = loc.replace(TARGET, '/proxy');
          } else {
            responseHeaders[key] = loc;
          }
          continue;
        }
        responseHeaders[key] = value;
      }

      // Allow embedding from anywhere
      responseHeaders['content-security-policy'] = "frame-ancestors *";
      // Allow cookies to work cross-origin
      responseHeaders['access-control-allow-origin'] = '*';
      responseHeaders['access-control-allow-credentials'] = 'true';

      res.writeHead(proxyRes.statusCode, responseHeaders);
      proxyRes.pipe(res, { end: true });
      proxyRes.on('end', resolve);
    });

    proxy.on('error', (e) => {
      console.error('Proxy error:', e.message);
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('502 – Proxy error: ' + e.message);
      resolve();
    });

    proxy.on('timeout', () => {
      proxy.destroy();
      res.writeHead(504, { 'Content-Type': 'text/plain' });
      res.end('504 – Gateway timeout');
      resolve();
    });

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      req.pipe(proxy, { end: true });
    } else {
      proxy.end();
    }
  });
};
