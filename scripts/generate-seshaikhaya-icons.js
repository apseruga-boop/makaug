'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const input = path.join(root, 'assets', 'icons', 'seshaikhaya-mark.svg');
const outputs = [
  ['seshaikhaya-icon-16.png', 16],
  ['seshaikhaya-icon-32.png', 32],
  ['seshaikhaya-apple-touch-icon.png', 180],
  ['seshaikhaya-icon-192.png', 192],
  ['seshaikhaya-icon-512.png', 512]
];

async function run() {
  if (!fs.existsSync(input)) throw new Error(`Missing ${input}`);
  for (const [name, size] of outputs) {
    await sharp(input).resize(size, size).png().toFile(path.join(path.dirname(input), name));
  }
  process.stdout.write(`Generated ${outputs.length} seshaikhaya icons.\n`);
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
