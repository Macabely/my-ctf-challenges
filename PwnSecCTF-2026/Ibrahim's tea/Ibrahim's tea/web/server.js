const http = require("http");

http.createServer((req, res) => {
  const url = new URL(req.url, "http://web:3000");
  const content = url.searchParams.get("content") ?? "";
  const rendered = content || "<span class=empty>No content provided.</span>";

  res.statusCode = 200;
  res.setHeader("Content-Security-Policy", "script-src 'none'");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Connection", "close");
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Ibrahim's tea</title>
  <style>
    body { font: 16px system-ui; max-width: 900px; margin: 48px auto; padding: 0 20px; background: #f5f5f5; }
    .box { min-height: 240px; padding: 24px; border: 1px solid #bbb; border-radius: 8px; background: white; overflow-wrap: anywhere; }
    .empty { color: #777; }
  </style>
</head>
<body>
  <h1>Ibrahim's tea</h1>
  <p>Content supplied through the <code>content</code> parameter is rendered below.</p>
  <section>
    <h2>Rendered content</h2>
    <div class="box">${rendered}</div>
  </section>
</body>
</html>`);
}).listen(3000, "0.0.0.0");
