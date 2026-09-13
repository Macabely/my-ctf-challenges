const express = require("express");
const rateLimit = require("express-rate-limit");
const puppeteer = require("puppeteer-core");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;
const APP_ORIGIN = new URL(process.env.APP_ORIGIN || "http://web:3000").origin;
const BOT_TOKEN = process.env.BOT_TOKEN || "bot-token";

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

app.get("/", (_req, res) => {
  res.render("index", {
    appOrigin: APP_ORIGIN
  });
});

const visitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate limited" }
});

app.use("/visit", visitLimiter);

let visiting = false;

app.post("/visit", async (req, res) => {
  const submittedUrl = String(req.body.url || "");
  let url;

  try {
    url = new URL(submittedUrl).href;
  } catch {
    return res.status(400).json({ error: "bad url" });
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return res.status(400).json({ error: "bad url" });
  }

  if (visiting) {
    return res.status(429).json({ error: "bot busy" });
  }

  visiting = true;
  try {
    await visit(url);
    return res.json({ message: "bot visited" });
  } catch {
    return res.status(500).json({ error: "The bot could not visit that URL." });
  } finally {
    visiting = false;
  }
});

async function visit(url) {
  let browser;
  try {
    console.log(`bot visiting ${url}`);
    browser = await puppeteer.launch({
      headless: "new",
      executablePath: "/usr/bin/chromium",
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--js-flags=--jitless",
        "--no-default-browser-check"
      ]
    });

    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", request => {
      const externalNavigation = page.url().startsWith(`${APP_ORIGIN}/notes/`)
        && request.isNavigationRequest()
        && request.frame() === page.mainFrame()
        && new URL(request.url()).origin !== APP_ORIGIN;
      externalNavigation ? request.abort() : request.continue();
    });

    await page.setExtraHTTPHeaders({ "X-Bot-Token": BOT_TOKEN });
    const sessionResponse = await page.goto(`${APP_ORIGIN}/bot/session`, {
      timeout: 5000,
      waitUntil: "domcontentloaded"
    });
    await page.setExtraHTTPHeaders({});
    if (!sessionResponse || !sessionResponse.ok()) {
      throw new Error(`bot session returned ${sessionResponse ? sessionResponse.status() : "no response"}`);
    }

    await page.goto(url, {
      timeout: 5000,
      waitUntil: "domcontentloaded"
    });
    await sleep(60_000);
    if (!page.isClosed()) {
      await page.close();
    }
    console.log(`bot finished ${url}`);
  } catch (err) {
    console.log(`bot failed ${url}: ${err.message}`);
    throw err;
  } finally {
    if (browser) await browser.close();
  }
}

app.listen(PORT, "0.0.0.0", () => console.log(`bot listening on ${PORT}`));
