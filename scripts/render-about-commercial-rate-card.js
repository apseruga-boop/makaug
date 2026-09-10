'use strict';

const fs = require('fs');
const path = require('path');
const { buildAboutCommercialRateCardPdf } = require('../services/aboutCommercialRateCardPdfService');

async function main() {
  const output = path.resolve(process.argv[2] || 'makaug-commercial-rate-card.pdf');
  const pdf = await buildAboutCommercialRateCardPdf();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, pdf);
  process.stdout.write(`${output}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
