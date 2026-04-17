# Intermac Assist – Vercel Proxy

Contingency access portal for `https://intramac.intermacassist.com/`
when users can't reach it directly due to Supabase DNS/HTTPS resolution issues.


## Structure

```
intermac-proxy/
├── api/
│   └── proxy.js       ← Vercel serverless function (reverse proxy)
├── public/
│   └── index.html     ← Full-screen iframe portal UI
└── vercel.json        ← Routing rules
```

## Deploy

```bash
npm i -g vercel
vercel
```

On first run Vercel will ask for your account and project name.
After deploy you'll get a URL like `https://intermac-proxy.vercel.app`.

## How it works

1. User opens the Vercel URL
2. `public/index.html` loads and points an iframe at `/proxy/`
3. Vercel routes `/proxy/*` to `api/proxy.js`
4. The serverless function forwards the request to `intramac.intermacassist.com`,
   strips `X-Frame-Options` and `Content-Security-Policy` headers,
   and streams the response back
5. The iframe renders the full SaaS

## Notes

- Vercel free tier: **10s** function timeout
- Vercel Pro: **60s** function timeout
- WebSockets / SSE are not supported through serverless functions
- Cookies and sessions should work for standard HTTP navigation
