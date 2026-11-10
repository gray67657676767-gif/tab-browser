# Tab Browser

A website with a built-in search browser. Searches and every link you click load inside the page, with tabs, back/forward and an address bar.

## Files

```
server.js            the proxy server (fetches pages for you)
public/index.html    the browser page
package.json
```

## Run it on your computer

1. Install Node.js 18 or newer (nodejs.org).
2. In this folder, run `npm start`.
3. Open http://localhost:3000

No packages to install.

## Put it online

Any host that runs Node works (Render, Railway, Replit, Glitch, a VPS). Upload these files, set the start command to `npm start`. The server reads the `PORT` setting the host gives it.

## Notes

- Searches go through DuckDuckGo's plain HTML results page.
- Simple sites (Wikipedia, docs, news, blogs) work best. Big apps that need logins or heavy scripts (YouTube, Google, Discord) often break through a basic proxy.
- Logins aren't kept between pages (cookies are dropped on purpose).
