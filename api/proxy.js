const https = require('https');
const url = require('url');

const TARGET = 'https://intramac.intermacassist.com';
const targetParsed = url.parse(TARGET);

const TOP_BAR = `
<div id="__contingency_bar__" style="position:fixed;top:0;left:0;right:0;height:40px;background:#111418;border-bottom:1px solid #1e2229;display:flex;align-items:center;gap:12px;padding:0 14px;z-index:2147483647;font-family:monospace;font-size:11px;user-select:none">
  <span style="font-weight:700;color:#00e5a0;letter-spacing:.04em;font-size:13px;font-family:sans-serif">INTERMAC ASSIST</span>
  <span style="width:1px;height:18px;background:#1e2229;flex-shrink:0"></span>
  <span style="width:7px;height:7px;border-radius:50%;background:#00e5a0;box-shadow:0 0 6px #00b87a;flex-shrink:0"></span>
  <span style="color:#00e5a0;letter-spacing:.06em">CONNECTED VIA US RELAY</span>
  <span style="flex:1"></span>
  <span style="color:#555d6b;letter-spacing:.04em">intermacassist.com</span>
  <span style="font-size:10px;color:#00b87a;background:rgba(0,229,160,.07);border:1px solid rgba(0,229,160,.18);border-radius:4px;padding:3px 8px;letter-spacing:.08em">🌐 US RELAY</span>
</div>
<style>#__contingency_bar__~*,body>*:not(#__contingency_bar__){margin-top:0}body{padding-top:40px!important}</style>`;

const ERROR_HTML = (title, msg, detail = '') => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}
body{font-family:monospace;background:#0a0c0f;color:#e8eaf0;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px}
h2{color:#ff4d6a;letter-spacing:.08em}p{color:#555d6b;font-size:12px;text-align:center;max-width:360px;line-height:1.7}
code{color:#00e5a0;background:rgba(0,229,160,.08);padding:2px 6px;border-radius:3px}
button{background:none;border:1px solid #ff4d6a;color:#ff4d6a;font-family:monospace;font-size:12px;letter-spacing:.06em;padding:8px 22px;border-radius:4px;cursor:pointer}
.badge{font-size:10px;color:#00b87a;background:rgba(0,229,160,.07);border:1px solid rgba(0,229,160,.18);border-radius:4px;padding:3px 8px;letter-spacing:.08em}
</style></head><body>
<span class="badge">🌐 US RELAY — intermac contingency</span>
<h2>${title}</h2>
<p>${msg}${detail ? `<br><br><code>${detail}</code>` : ''}</p>
<button onclick="location.reload()">RETRY</button>
</body></html>`;

function isTextType(contentType) {
  return /text\/|application\/(json|javascript|x-javascript)/.test(contentType || '');
}

function injectBar(html) {
  const idx = html.lastIndexOf('</body>');
  if (idx !== -1) return html.slice(0, idx) + TOP_BAR + html.slice(idx);
  const idx2 = html.lastIndexOf('</html>');
  if (idx2 !== -1) return html.slice(0, idx2) + TOP_BAR + html.slice(idx2);
  return html + TOP_BAR;
}

function rewriteSupabase(text, proxyHost) {
  // Rewrite any supabase.co URL to go through our /sb/ relay
  return text.replace(
    /https?:\/\/([a-zA-Z0-9-]+\.supabase\.co)/g,
    `https://${proxyHost}/sb/$1`
  );
}

module.exports = async (req, res) => {
  // Handle CORS preflight
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

  const proxyHost = req.headers.host;
  const forwardHeaders = { ...req.headers };
  forwardHeaders['host'] = targetParsed.hostname;
  delete forwardHeaders['connection'];
  delete forwardHeaders['transfer-encoding'];
  delete forwardHeaders['accept-encoding']; // disable compression so we can rewrite text

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
      const contentType = proxyRes.headers['content-type'] || '';
      const isText = isTextType(contentType);
      const isHtml = /text\/html/.test(contentType);

      const outHeaders = {};
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        const lower = k.toLowerCase();
        if (lower === 'x-frame-options') continue;
        if (lower === 'content-security-policy') continue;
        if (lower === 'content-security-policy-report-only') continue;
        if (lower === 'content-encoding') continue; // removed accept-encoding above
        if (lower === 'content-length') continue;   // length changes after rewrite
        outHeaders[k] = v;
      }
      outHeaders['access-control-allow-origin'] = '*';
      outHeaders['access-control-allow-headers'] = '*';
      outHeaders['x-proxied-by'] = 'intermac-contingency-us';

      if (!isText) {
        res.writeHead(proxyRes.statusCode, outHeaders);
        proxyRes.pipe(res, { end: true });
        proxyRes.on('end', resolve);
        return;
      }

      const chunks = [];
      proxyRes.on('data', c => chunks.push(c));
      proxyRes.on('end', () => {
        let content = Buffer.concat(chunks).toString('utf8');
        content = rewriteSupabase(content, proxyHost);
        if (isHtml) content = injectBar(content);
        const buf = Buffer.from(content, 'utf8');
        outHeaders['content-length'] = String(buf.length);
        res.writeHead(proxyRes.statusCode, outHeaders);
        res.end(buf);
        resolve();
      });
    });

    proxy.on('error', e => {
      console.error('Proxy error:', e.message);
      res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(ERROR_HTML('RELAY ERROR', 'Cannot reach <code>intramac.intermacassist.com</code>', e.message));
      resolve();
    });

    proxy.on('timeout', () => {
      proxy.destroy();
      res.writeHead(504, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(ERROR_HTML('RELAY TIMEOUT', 'Gateway timeout reaching <code>intramac.intermacassist.com</code>'));
      resolve();
    });

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      req.pipe(proxy, { end: true });
    } else {
      proxy.end();
    }
  });
};
