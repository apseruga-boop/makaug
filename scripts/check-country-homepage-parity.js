const fs = require("fs");
const path = require("path");

const { SHARED_CORE_PHASE1_MARKER } = require("../packages/shared-country-core");

const TARGETS = Object.freeze([
  Object.freeze({
    country: "UG",
    url: process.env.MAKAUG_PARITY_URL || "https://makaug.com/",
    expected: Object.freeze([
      'id="page-home"',
      'id="hero-title"',
      'id="home-ask-ai-feature"',
      'id="home-grid"',
      'id="home-brokers"',
      'id="map-home"',
      "<footer"
    ])
  }),
  Object.freeze({
    country: "KE",
    url: process.env.NYUMBAKE_PARITY_URL || "https://nyumbake.com/",
    expected: Object.freeze([
      'data-country-code="KE"',
      'id="page-home"',
      'id="hero-title"',
      'id="home-ask-ai-feature"',
      'id="home-grid"',
      'id="home-brokers"',
      'id="map-home"',
      "<footer"
    ])
  })
]);

async function inspect(target) {
  const response = await fetch(`${target.url}${target.url.includes("?") ? "&" : "?"}parity=${Date.now()}`, {
    headers: { "User-Agent": "whispers-country-parity-watch/1.0" },
    signal: AbortSignal.timeout(20_000)
  });
  const html = await response.text();
  const missing = target.expected.filter((needle) => !html.includes(needle));
  if (!html.includes(SHARED_CORE_PHASE1_MARKER)) missing.push(SHARED_CORE_PHASE1_MARKER);
  return {
    country: target.country,
    url: target.url,
    status: response.status,
    ok: response.ok && missing.length === 0,
    missing
  };
}

async function main() {
  const results = [];
  for (const target of TARGETS) results.push(await inspect(target));
  const report = {
    checked_at: new Date().toISOString(),
    marker: SHARED_CORE_PHASE1_MARKER,
    results
  };
  const reportPath = process.env.PARITY_REPORT_PATH
    || path.join(process.cwd(), "country-homepage-parity-report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Country parity watch failed: ${error.message}`);
  process.exitCode = 1;
});
