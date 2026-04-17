const https = require('https');
const url = require('url');

const TARGET = 'https://intramac.intermacassist.com';
const targetParsed = url.parse(TARGET);

const ERROR_PAGE = (title, msg, detail = '') => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:monospace;background:#0a0c0f;color:#e8eaf0;
       display:flex;align-items:center;justify-content:center;
       height:100vh;flex-direction:column;gap:16px}
  h2{color:#ff4d6a;letter-spacing:.08em;font-size:18px}
  p{color:#555d6b;font-size:12px;text-align:center;max-width:360px;line-height:1.7}
  code{color:#00e5a0;background:rgba(0,229,160,.08);padding:2px 6px;border-radius:3px}
  button{margin-top:4px;background:none;border:1px solid #ff4d6a;color:#ff4d6a;
         font-family:monospace;font-size:12px;letter-spacing:.06em;
         padding:8px 22px;border-radius:4px;cursor:pointer}
  button:hover{background:rgba(255,77,106,.1)}
  .badge{font-size:10px;color:#00b87a;background:rgba(0,229,160,.07);
         border:1px solid rgba(0,229,160,.18);border-radius:4px;
         padding:3px 8px;letter-spacing:.08em}
</style></head>
<body>
  <span class="badge">🌐 US RELAY — intermac contingency</span>
  <h2>${title}</h2>
  <p>${msg}${detail ? `<br><br><code>${detail}</code>` : ''}</p>
  <button onclick="location.reload()">RETRY</button>
</body></html>`;

module.exports = async (req, res) => {
  const forwardHeaders = { ...req.headers };
  forwardHeaders['host'] = targetParsed.hostname;
  delete forwardHeaders['connection'];
  delete forwardHeaders['transfer-encoding'];

  const options = {
    hostname: targetParsed.hostname,
    port: 443,
    path: req.url || '/',
    method: req.method,
    headers: forwardHeaders,
    timeout: 8000,
  };

  return new Promise((resolve) => {
    const proxy = https.request(options, (proxyRes) => {
      const responseHeaders = {};
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        const lower = key.toLowerCase();
        if (lower === 'x-frame-options') continue;
        if (lower === 'content-security-policy') continue;
        if (lower === 'content-security-policy-report-only') continue;
        responseHeaders[key] = value;
      }
      responseHeaders['x-proxied-by'] = 'intermac-contingency-us';
      responseHeaders['access-control-allow-origin'] = '*';

      res.writeHead(proxyRes.statusCode, responseHeaders);
      proxyRes.pipe(res, { end: true });
      proxyRes.on('end', resolve);
    });

    proxy.on('error', (e) => {
      console.error('Proxy error:', e.message);
      res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(ERROR_PAGE(
        'RELAY ERROR',
        'Cannot reach <code>intramac.intermacassist.com</code> through this relay.',
        e.message
      ));
      resolve();
    });

    proxy.on('timeout', () => {
      proxy.destroy();
      res.writeHead(504, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(ERROR_PAGE(
        'RELAY TIMEOUT',
        'Gateway timeout while connecting to <code>intramac.intermacassist.com</code>.'
      ));
      resolve();
    });

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      req.pipe(proxy, { end: true });
    } else {
      proxy.end();
    }
  });
};
