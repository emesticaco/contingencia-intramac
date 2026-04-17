const https = require('https');
const http = require('http');
const url = require('url');

// Receives: /api/sb?_u=https%3A%2F%2Fproject.supabase.co%2F...
// Forwards to the decoded Supabase URL server-side (DNS from US, not client)
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'access-control-max-age': '86400',
    });
    res.end();
    return;
  }

  const parsed = url.parse(req.url, true);
  const targetUrlStr = parsed.query._u;

  if (!targetUrlStr || !targetUrlStr.includes('.supabase.co')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing or invalid _u parameter', got: targetUrlStr }));
    return;
  }

  const t = url.parse(targetUrlStr);
  const targetHost = t.hostname;
  const targetPath = t.path; // includes pathname + query string

  const forwardHeaders = { host: targetHost, accept: 'application/json' };
  const keep = ['apikey', 'authorization', 'content-type', 'prefer',
                'x-client-info', 'x-supabase-api-version', 'range'];
  for (const h of keep) {
    if (req.headers[h]) forwardHeaders[h] = req.headers[h];
  }

  const protocol = t.protocol === 'https:' ? https : http;
  const options = {
    hostname: targetHost,
    port: t.protocol === 'https:' ? 443 : 80,
    path: targetPath,
    method: req.method,
    headers: forwardHeaders,
    timeout: 8000,
  };

  return new Promise((resolve) => {
    const proxy = protocol.request(options, (proxyRes) => {
      const outHeaders = { ...proxyRes.headers };
      outHeaders['access-control-allow-origin'] = '*';
      outHeaders['access-control-allow-headers'] = '*';
      outHeaders['access-control-allow-methods'] = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
      delete outHeaders['connection'];

      res.writeHead(proxyRes.statusCode, outHeaders);
      proxyRes.pipe(res, { end: true });
      proxyRes.on('end', resolve);
    });

    proxy.on('error', e => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'supabase_relay_error', detail: e.message }));
      resolve();
    });

    proxy.on('timeout', () => {
      proxy.destroy();
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'supabase_relay_timeout' }));
      resolve();
    });

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      req.pipe(proxy, { end: true });
    } else {
      proxy.end();
    }
  });
};
