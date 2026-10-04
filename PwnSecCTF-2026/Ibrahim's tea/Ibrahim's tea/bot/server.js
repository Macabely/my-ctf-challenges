const http = require("http");
const puppeteer = require("puppeteer");

const APP_ORIGIN = process.env.APP_ORIGIN || "http://web:3000";
const FLAG = process.env.FLAG || "flag{test_flag}";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function visit(url) {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        '--js-flags=--jitless',
        "--disable-gpu",
      ],
  });

  try {
    let page = await browser.newPage();
    await page.goto(APP_ORIGIN, { waitUntil: "domcontentloaded", timeout: 5000 });
    await page.evaluate(flag => localStorage.setItem("flag", flag), FLAG);
    await page.close();

    page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 5000 }).catch(() => {});
    await sleep(10000);
  } finally {
    await browser.close();
  }
}

function form(message = "") {
  return `<!doctype html>
<title>Bot</title>
<h1>Bot</h1>
<form method="post" action="/visit">
  <input name="url" placeholder="https://example.com" required>
  <button>Visit</button>
</form>
<pre>${message}</pre>`;
}

http.createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (req.method === "GET" && req.url === "/") {
    res.end(form());
    return;
  }

  if (req.method !== "POST" || req.url !== "/visit") {
    res.statusCode = 404;
    res.end();
    return;
  }

  let body = "";
  req.on("data", chunk => body += chunk);
  req.on("end", async () => {
    const url = new URLSearchParams(body).get("url") || "";

    if (!/^https?:\/\//.test(url)) {
      res.statusCode = 400;
      res.end(form("Invalid URL"));
      return;
    }

    try {
      await visit(url);
      res.end(form("Visited"));
    } catch (error) {
      res.statusCode = 500;
      res.end(form("Error"));
    }
  });
}).listen(3001, "0.0.0.0");
