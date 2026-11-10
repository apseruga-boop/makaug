'use strict';

// Render the three off-plan brochure samples for one project. Writes PDFs and
// a cover plus two inner-page PNGs. Does not change the public download.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { BROCHURE_DESIGNS, brochureDesignBuffer } = require('../services/offPlanBrochureDesigns');
const { brochureBuffer } = require('../services/offPlanBrochureService');

async function main() {
  const slug = process.argv[2] || 'vanta-house';
  const outDir = path.resolve(process.argv[3] || path.join('tmp', 'brochure-options'));
  const projectPath = path.join(__dirname, '..', 'data', 'off-plan', `${slug}.development.json`);
  const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = [];
  for (const design of BROCHURE_DESIGNS) {
    const pdf = await brochureDesignBuffer(project, design.id);
    const pdfName = `${slug}-${design.id}.pdf`;
    const pdfPath = path.join(outDir, pdfName);
    fs.writeFileSync(pdfPath, pdf);
    const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    const prefix = path.join(outDir, `${slug}-${design.id}-page`);
    const wanted = [design.cover, ...design.inner];
    execFileSync('pdftoppm', ['-png', '-r', '120', '-f', String(Math.min(...wanted)), '-l', String(Math.max(...wanted)), pdfPath, prefix], { stdio: 'inherit' });
    const names = ['cover', 'inner-a', 'inner-b'];
    const pngs = wanted.map((page, index) => {
      const rendered = `${prefix}-${page}.png`;
      const target = path.join(outDir, `${slug}-${design.id}-${names[index]}.png`);
      fs.renameSync(rendered, target);
      return target;
    });
    manifest.push({ design: design.id, label: design.label, pages, pdf: pdfPath, pngs });
    console.log(`${design.id}: ${pages} pages, ${pdf.length} bytes`);
  }
  const current = await brochureBuffer(project, { language: 'en' });
  const currentPath = path.join(outDir, `${slug}-current.pdf`);
  fs.writeFileSync(currentPath, current);
  const currentPages = (current.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
  console.log(`current: ${currentPages} pages, ${current.length} bytes`);
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ manifest, current: currentPath, currentPages }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
