const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const indexHtml = fs.readFileSync(
  path.join(__dirname, "..", "index.html"),
  "utf8"
);

test("publishes the Meta domain verification tag in the static document head", () => {
  const head = indexHtml.match(/<head>([\s\S]*?)<\/head>/i)?.[1] || "";

  assert.match(
    head,
    /<meta name="facebook-domain-verification" content="wn68k5n1hmg16xalket31iuwsqwa51">/
  );
  assert.match(head, /meta-domain-verification-20260730/);
});
