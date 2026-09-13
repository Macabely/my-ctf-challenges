const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const MarkdownIt = require("markdown-it");
const { JSDOM } = require("jsdom");
const DOMPurify = require("dompurify")(new JSDOM("").window);

const app = express();
const notes = new Map();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const BOT_SESSION_ID = process.env.BOT_SESSION_ID || "bot-session";
const BOT_TOKEN = process.env.BOT_TOKEN || "bot-token";
const FLAG = process.env.FLAG || "FLAG{test_flag}";
const md = new MarkdownIt({ html: true, linkify: false });

app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: "sid",
  secret: SESSION_SECRET,
  genid: req => req.get("X-Bot-Token") === BOT_TOKEN
    ? BOT_SESSION_ID
    : crypto.randomBytes(18).toString("hex"),
  resave: false,
  saveUninitialized: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
  }
}));

function csp(res, nonce, options = {}) {
  const connectSrc = options.connectSrc || "'none'";
  const directives = [
    "default-src 'none'",
    `script-src 'self' https://esm.sh/gh/PrismJS/prism@36ad7f8/ 'nonce-${nonce}' data:`,
    `style-src 'nonce-${nonce}'`,
    `connect-src ${connectSrc}`,
    "form-action 'self'",
    "base-uri 'none'"
  ];
  if (options.sandbox) {
    directives.push("sandbox allow-scripts allow-same-origin");
  }
  res.setHeader("Content-Security-Policy", directives.join("; "));
}

function renderNote(body) {
  return DOMPurify.sanitize(md.render(body));
}

function renderText(text) {
  return DOMPurify.sanitize(String(text), { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

function isDocumentNavigation(req, { allowMissing = false } = {}) {
  const mode = req.get("Sec-Fetch-Mode");
  return mode === "navigate" || (allowMissing && !mode);
}

function notePageHtml(note, nonce) {
  const title = renderText(note.title);
  const body = renderNote(note.body);
  return `<!doctype html><title>${title}</title>
  <script nonce="${nonce}">window.opener = null</script>
  <style nonce="${nonce}">body{font-family:sans-serif;max-width:760px;margin:40px auto}</style>
  <p><a href="/">Home</a></p>
  <h1>${title}</h1>
  <main>${body}</main>
  <script nonce="${nonce}" type="module" src="https://esm.sh/gh/PrismJS/prism@36ad7f8/src/global.js"></script>`;
}

const flagId = crypto.randomBytes(4).toString("hex");
notes.set(flagId, {
  owner: BOT_SESSION_ID,
  title: "flag draft",
  body: FLAG
});
console.log(`flag note id: ${flagId}`);


app.get("/bot/session", (req, res) => {
  if (req.get("X-Bot-Token") !== BOT_TOKEN) {
    return res.status(404).send("not found");
  }
  req.session.bot = true;
  res.send("ok");
});

app.get("/", (req, res) => {
  const nonce = crypto.randomBytes(16).toString("base64");
  csp(res, nonce);
  res.send(`<!doctype html><title>Notes</title>
  <style nonce="${nonce}">body{font-family:sans-serif;max-width:760px;margin:40px auto}textarea{width:100%;height:220px}</style>
  <h1>Notes</h1>
  <p><a href="/notes">Search</a></p>
  <form method=post action=/notes>
    <p><input name=title placeholder=title required></p>
    <textarea name=body maxlength=80 placeholder="Markdown notes"></textarea>
    <p><button>Create</button></p>
  </form>`);
});

app.post("/notes", (req, res) => {
  if (!isDocumentNavigation(req)) {
    return res.status(404).send("not found");
  }

  const body = String(req.body.body || "");
  if (body.length > 80) return res.status(400).send("note too long");

  const id = crypto.randomBytes(4).toString("hex");
  notes.set(id, {
    owner: null,
    title: req.body.title || "untitled",
    body
  });
  res.redirect(`/notes/${id}`);
});

app.get("/notes", (req, res) => {
  if (!isDocumentNavigation(req, { allowMissing: true })) {
    return res.status(404).send("not found");
  }

  const owner = req.sessionID;
  const search = String(req.query.search || "");
  if (!/^[a-f0-9]{0,8}$/.test(search)) return res.status(400).send("bad search");

  const matches = [...notes.entries()].filter(([id, note]) => {
    if (note.owner && note.owner !== owner) return false;
    return id.startsWith(search);
  });
  const hasMatch = matches.length > 0;
  res.status(hasMatch ? 200 : 404).send(`<!doctype html>
  <title>Notes</title>
  <style>body{font-family:sans-serif;max-width:760px;margin:40px auto}</style>
  <p><a href="/">Home</a></p>
  <h1>Search</h1>
  <form method=get action=/notes>
    <p><input name=search value="${renderText(search)}" autocomplete=off></p>
    <p><button>Filter</button></p>
  </form>
  ${hasMatch ? `
    <ul>
      ${matches.map(([id]) => `
        <li><a href="/notes/${id}">${id}</a></li>
      `).join("")}
    </ul>
  ` : "<p>No notes found.</p>"}`);
});

app.get("/notes/:id", (req, res) => {
  const owner = req.sessionID;
  const note = notes.get(req.params.id);

  if (!note) return res.status(404).send("not found");
  if (note.owner && note.owner !== owner) return res.status(404).send("not found");

  const nonce = crypto.randomBytes(16).toString("base64");
  const origin = `${req.protocol}://${req.get("host")}`;
  csp(res, nonce, {
    sandbox: true,
    connectSrc: `${origin}/notes/`
  });
  res.send(notePageHtml(note, nonce));
});

app.listen(PORT, "0.0.0.0", () => console.log(`app listening on ${PORT}`));
