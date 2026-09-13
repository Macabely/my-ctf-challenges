# mouse-in-the-house

# Solution

The challenge uses Prism V2 and the latest dompurify. If you look at its [code](https://github.com/PrismJS/prism/blob/v2/src/config.js#L12-L28), you will find that Prism V2 treats `data-prism-*` attributes anywhere in the document as global Prism configuration in the [globalDefaults](https://github.com/PrismJS/prism/blob/v2/src/config.js#L67-L74) object. 
Prism creates the plugin registry using the plugin path, then preloads it on [startup](https://github.com/PrismJS/prism/blob/v2/src/core/classes/prism.js#L64-L79). after that it [loads](https://github.com/PrismJS/prism/blob/v2/src/core/classes/component-registry.js#L188) the plugin.

So a note like this:
```html
<div
  data-prism-plugins="p"
  data-prism-plugin-path="data:text/javascript,code;//">
</div>
```
will cause XSS and pass dompurify too cause dompurify allows [data-*](https://github.com/cure53/DOMPurify/wiki/Default-TAGs-ATTRIBUTEs-allow-list-&-blocklist#data-and-aria-attributes) attributes by default.

The note page has a strict CSP, the intended was to bypass it using WebRTC with a TURN server to leak data. The `/notes` endpoint has a search function that searches for note IDs by character.
There is a thing you need to understand first. When you open a window with `window.open`, this window will first create a [about:blank](https://developer.mozilla.org/en-US/docs/Web/API/Window/open#description) document, and it will be active until the requested URL loads. 

If that URL loads a 200 response, Chrome will call [PROCEED](https://source.chromium.org/chromium/chromium/src/+/main:content/browser/renderer_host/http_error_navigation_throttle.cc;l=52-55) and do the navigation immediately. If the URL loads a 404 response, Chrome will call [DEFER](https://source.chromium.org/chromium/chromium/src/+/main:content/browser/renderer_host/http_error_navigation_throttle.cc;l=59-66) and will wait to see if that response has a body. If not, Chrome will create its own 404 page and navigate to it. Because the 404 has more processing, navigating from `about:blank` to a 200 or 404 page will have a timing gap of almost 1ms. 

When the window is still on `about:blank`, you can access it, and you can call `win.origin`. After the navigation happens, the window becomes cross-origin, and accessing `win.origin` will throw a DOMException error. So, between the timing from `about:blank` (accessing `win.origin` will be fine) to the navigation (accessing `win.origin` will throw an error) to 200 (which will be faster than 404) or 404 page, you can distinguish the right character from the wrong one.
