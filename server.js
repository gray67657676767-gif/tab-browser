// Tab Browser — a small proxy server. Node 18+ required, no packages needed.
// Run: node server.js   then open http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Headers that would stop a page from loading inside our frame
const DROP = new Set([
  'content-security-policy', 'content-security-policy-report-only',
  'x-frame-options', 'content-encoding', 'content-length',
  'transfer-encoding', 'strict-transport-security', 'set-cookie', 'connection'
]);

const prox = (u) => '/p?url=' + encodeURIComponent(u);

function absolute(val, base) {
  try { return new URL(val.replace(/&amp;/g, '&'), base).href; } catch { return null; }
}

// Script injected into every proxied page: keeps links, forms and new windows in the tab
function injected(realUrl) {
  return `<script>(function(){
var REAL=${JSON.stringify(realUrl)};
try{parent.postMessage({tabBrowser:true,url:REAL,title:document.title},'*');}catch(e){}
addEventListener('load',function(){try{parent.postMessage({tabBrowser:true,url:REAL,title:document.title},'*');}catch(e){}});
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a');if(a)a.target='_self';},true);
document.addEventListener('submit',function(e){
  var f=e.target;if((f.method||'get').toLowerCase()!=='get')return;
  var act=new URL(f.action||location.href,location.href);var t=act.searchParams.get('url')||REAL;
  e.preventDefault();var u=new URL(t);u.search='';
  new FormData(f).forEach(function(v,k){if(typeof v==='string')u.searchParams.append(k,v);});
  location.href='/p?url='+encodeURIComponent(u.href);
},true);
window.open=function(u){if(u)location.href='/p?url='+encodeURIComponent(new URL(u,REAL).href);return window;};
})();</script>`;
}

function rewriteHtml(html, base) {
  html = html.replace(/(\s(?:href|src|action|poster)\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, val) => {
    if (/^\s*(javascript:|data:|blob:|mailto:|tel:|#)/i.test(val)) return m;
    const abs = absolute(val, base);
    return abs ? `${pre}${q}${prox(abs)}${q}` : m;
  });
  html = html.replace(/\s(?:integrity|srcset)\s*=\s*(["']).*?\1/gi, '');
  html = html.replace(/<base\b[^>]*>/gi, '');
  html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy[^>]*>/gi, '');
  html = rewriteCss(html, base);
  const script = injected(base);
  return /<head[^>]*>/i.test(html)
    ? html.replace(/<head([^>]*)>/i, `<head$1>${script}`)
    : script + html;
}

function rewriteCss(css, base) {
  return css.replace(/url\(\s*(["']?)(?!data:)(.*?)\1\s*\)/gi, (m, q, val) => {
    const abs = absolute(val, base);
    return abs ? `url(${q}${prox(abs)}${q})` : m;
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function errorPage(res, msg) {
  res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<body style="font-family:system-ui;padding:40px;color:#334">
<h2>Couldn't load this page</h2><p>${msg.replace(/</g, '&lt;')}</p>
<p>Some sites block proxies. Try another result or check the address.</p></body>`);
}

async function proxy(req, res, target) {
  let url;
  try { url = new URL(target); } catch { return errorPage(res, 'That address is not valid.'); }
  if (!/^https?:$/.test(url.protocol)) return errorPage(res, 'Only http and https pages can be opened.');

  try {
    const opts = {
      method: req.method,
      redirect: 'follow',
      headers: { 'user-agent': UA, 'accept': req.headers.accept || '*/*', 'accept-language': 'en-US,en;q=0.9' }
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      opts.body = await readBody(req);
      if (req.headers['content-type']) opts.headers['content-type'] = req.headers['content-type'];
    }
    const r = await fetch(url, opts);
    const finalUrl = r.url || url.href;
    const type = r.headers.get('content-type') || '';

    const headers = {};
    r.headers.forEach((v, k) => { if (!DROP.has(k)) headers[k] = v; });

    if (type.includes('text/html')) {
      const html = rewriteHtml(await r.text(), finalUrl);
      res.writeHead(r.status, { ...headers, 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    if (type.includes('text/css')) {
      res.writeHead(r.status, headers);
      return res.end(rewriteCss(await r.text(), finalUrl));
    }
    res.writeHead(r.status, headers);
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    errorPage(res, e.message || 'Network error.');
  }
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://local');

  if (u.pathname === '/' || u.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return fs.createReadStream(fs.existsSync(path.join(__dirname, 'index.html')) ? path.join(__dirname, 'index.html') : path.join(__dirname, 'public', 'index.html')).pipe(res);
  }

  if (u.pathname === '/p') {
    const target = u.searchParams.get('url');
    if (!target) return errorPage(res, 'No address given.');
    return proxy(req, res, target);
  }

  // A proxied page asked for a path on its own site (e.g. /api/data) — resolve it from the page it came from
  const ref = req.headers.referer;
  if (ref) {
    try {
      const refTarget = new URL(ref).searchParams.get('url');
      if (refTarget) return proxy(req, res, new URL(req.url, refTarget).href);
    } catch {}
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
}).listen(PORT, () => console.log(`Tab Browser running at http://localhost:${PORT}`));
