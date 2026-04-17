const https = require('https');
const url = require('url');

const TARGET = 'https://intramac.intermacassist.com';
const targetParsed = url.parse(TARGET);

// Service worker served at /sw-contingency.js
// Intercepts ALL fetch calls at network level — can't be bypassed by bundled code
const SW_CODE = `
const SB_RE = /^https?:\\/\\/[a-zA-Z0-9\\-]+\\.supabase\\.co/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const url = event.request.url;
  if (!SB_RE.test(url)) return;

  const origin = new URL(self.registration.scope).origin;
  const newUrl = origin + '/api/sb?_u=' + encodeURIComponent(url);

  event.respondWith(
    fetch(new Request(newUrl, event.request)).catch(err => new Response(
      JSON.stringify({ error: 'sb_relay_failed', detail: err.message }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    ))
  );
});
`.trim();

// Injected into <head> — registers SW and falls back to window.fetch patch
const INJECT_SCRIPT = `<script data-contingency="1">
(function(){
  // Service worker (primary — intercepts at network level)
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/sw-contingency.js',{scope:'/'}).then(function(reg){
      if(!navigator.serviceWorker.controller){
        // First install: reload once SW is active so it can intercept from the start
        navigator.serviceWorker.addEventListener('controllerchange',function(){
          window.location.reload();
        });
      }
    }).catch(function(e){ console.warn('[relay] SW failed:',e); });
  }

  // window.fetch patch (fallback for browsers with SW issues)
  var SB=/^(https?:\\/\\/[a-zA-Z0-9\\-]+\\.supabase\\.co)(.*)?$/;
  function rw(u){
    if(typeof u!=='string')return u;
    var m=u.match(SB);
    if(!m)return u;
    return location.origin+'/api/sb?_u='+encodeURIComponent(u);
  }
  var oF=window.fetch;
  window.fetch=function(r,i){
    if(typeof r==='string')r=rw(r);
    else if(r&&r.url){var n=rw(r.url);if(n!==r.url)r=new Request(n,r);}
    return oF.call(this,r,i);
  };
  var oX=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){
    return oX.apply(this,[m,rw(u)].concat([].slice.call(arguments,2)));
  };
})();
</script>`;

const TOP_BAR = `<div id="__cb__" style="position:fixed;top:0;left:0;right:0;height:40px;background:#111418;border-bottom:1px solid #1e2229;display:flex;align-items:center;gap:12px;padding:0 14px;z-index:2147483647;font-family:monospace;font-size:11px;user-select:none;box-sizing:border-box">
  <span style="font-weight:700;color:#00e5a0;letter-spacing:.04em;font-size:13px;font-family:sans-serif">INTERMAC ASSIST</span>
  <span style="width:1px;height:18px;background:#1e2229;flex-shrink:0"></span>
  <span style="width:7px;height:7px;border-radius:50%;background:#00e5a0;box-shadow:0 0 6px #00b87a;flex-shrink:0"></span>
  <span style="color:#00e5a0;letter-spacing:.06em">CONNECTED VIA US RELAY</span>
  <span style="flex:1"></span>
  <span style="color:#555d6b;font-size:10px;letter-spacing:.04em">intermacassist.com</span>
  <span style="font-size:10px;color:#00b87a;background:rgba(0,229,160,.07);border:1px solid rgba(0,229,160,.18);border-radius:4px;padding:3px 8px;letter-spacing:.08em">&#127760; US RELAY</span>
</div>
<style>body{padding-top:40px!important;box-sizing:border-box}</style>`;

const ERROR_HTML = (title, msg, detail) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:monospace;background:#0a0c0f;color:#e8eaf0;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px}
h2{color:#ff4d6a;letter-spacing:.08em}p{color:#555d6b;font-size:12px;text-align:center;max-width:380px;line-height:1.7}
code{color:#00e5a0;background:rgba(0,229,160,.08);padding:2px 6px;border-radius:3px}
button{background:none;border:1px solid #ff4d6a;color:#ff4d6a;font-family:monospace;font-size:12px;letter-spacing:.06em;padding:8px 22px;border-radius:4px;cursor:pointer}
.badge{font-size:10px;color:#00b87a;background:rgba(0,229,160,.07);border:1px solid rgba(0,229,160,.18);border-radius:4px;padding:3px 8px;letter-spacing:.08em}</style></head>
<body><span class="badge">&#127760; US RELAY &mdash; intermac contingency</span>
<h2>${title}</h2><p>${msg}${detail ? `<br><br><code>${detail}</code>` : ''}</p>
<button onclick="location.reload()">RETRY</button></body></html>`;

function injectHead(html) {
  if (html.includes('<head>')) return html.replace('<head>', '<head>' + INJECT_SCRIPT);
  const m = html.match(/<head[^>]*>/);
  if (m) return html.replace(m[0], m[0] + INJECT_SCRIPT);
  if (html.includes('<html')) return html.replace(/<html[^>]*>/, t => t + INJECT_SCRIPT);
  return INJECT_SCRIPT + html;
}

function injectBar(html) {
  const i = html.lastIndexOf('</body>');
  if (i !== -1) return html.slice(0, i) + TOP_BAR + html.slice(i);
  const j = html.lastIndexOf('</html>');
  if (j !== -1) return html.slice(0, j) + TOP_BAR + html.slice(j);
  return html + TOP_BAR;
}

module.exports = async (req, res) => {
  // Serve service worker directly — do not proxy to target
  if (req.url === '/sw-contingency.js') {
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
      'Service-Worker-Allowed': '/',
    });
    res.end(SW_CODE);
    return;
  }

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

  const forwardHeaders = { ...req.headers };
  forwardHeaders['host'] = targetParsed.hostname;
  delete forwardHeaders['connection'];
  delete forwardHeaders['transfer-encoding'];
  delete forwardHeaders['accept-encoding'];

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
      const ct = proxyRes.headers['content-type'] || '';
      const isHtml = /text\/html/.test(ct);

      const outHeaders = {};
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        const l = k.toLowerCase();
        if (l === 'x-frame-options') continue;
        if (l === 'content-security-policy') continue;
        if (l === 'content-security-policy-report-only') continue;
        if (l === 'content-encoding') continue;
        if (l === 'content-length') continue;
        outHeaders[k] = v;
      }
      outHeaders['access-control-allow-origin'] = '*';
      outHeaders['access-control-allow-headers'] = '*';
      outHeaders['x-proxied-by'] = 'intermac-contingency-us';

      if (!isHtml) {
        res.writeHead(proxyRes.statusCode, outHeaders);
        proxyRes.pipe(res, { end: true });
        proxyRes.on('end', resolve);
        return;
      }

      const chunks = [];
      proxyRes.on('data', c => chunks.push(c));
      proxyRes.on('end', () => {
        let html = Buffer.concat(chunks).toString('utf8');
        html = injectHead(html);
        html = injectBar(html);
        const buf = Buffer.from(html, 'utf8');
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
