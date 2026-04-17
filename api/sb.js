const https = require('https');

// Proxies Supabase API calls server-side so DNS resolves from US, not client
// Incoming: /sb/project.supabase.co/rest/v1/...
// Forwards to: https://project.supabase.co/rest/v1/...
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

  // Strip /sb/ prefix → "project.supabase.co/rest/v1/..."
  const withoutPrefix = (req.url || '/').replace(/^\/sb\//, '');
  const slashIdx = withoutPrefix.indexOf('/');
  const targetHost = slashIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, slashIdx);
  const targetPath = slashIdx === -1 ? '/' : withoutPrefix.slice(slashIdx);

  if (!targetHost.endsWith('.supabase.co')) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  const forwardHeaders = { ...req.headers };
  forwardHeaders['host'] = targetHost;
  delete forwardHeaders['connection'];
  delete forwardHeaders['transfer-encoding'];

  const options = {
    hostname: targetHost,
    port: 443,
    path: targetPath,
    method: req.method,
    headers: forwardHeaders,
    timeout: 8000,
  };

  return new Promise((resolve) => {
    const proxy = https.request(options, (proxyRes) => {
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
      console.error('Supabase relay error:', e.message);
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
