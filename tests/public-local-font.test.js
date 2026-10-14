'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createPublicFontFaceInliner } = require('../services/publicFontFaces');
const pinned = require('../assets/fonts/plus-jakarta-sans-optional.source.json');
const local = require('../assets/fonts/plus-jakarta-sans-latin.source.json');
const originalCss = fs.readFileSync(require.resolve('../assets/fonts/plus-jakarta-sans-optional.css'),'utf8');
const bytes = fs.readFileSync(require.resolve('../assets/fonts/plus-jakarta-sans-latin.woff2'));
const localUrl = `/assets/fonts/plus-jakarta-sans-latin.woff2?v=${local.sha256.slice(0,12)}`;
const input = `<html><head><meta charset="UTF-8"><link rel="stylesheet" href="${pinned.sourceUrl}"></head><body><h1>Find your next home</h1></body></html>`;
const fontStyle = (html) => html.match(/<style data-public-font-faces="jakarta"[^>]*>([\s\S]*?)<\/style>/)?.[1];
test('public first paint uses the exact local font once for preload and all five Latin faces',()=>{
 assert.equal(bytes.subarray(0,4).toString(),'wOF2'); assert.equal(bytes.length,local.bytes);
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),local.sha256);
 const output=createPublicFontFaceInliner()(input);const rendered=fontStyle(output);
 assert.equal(rendered,originalCss.replaceAll(`url(${local.sourceUrl})`,`url(${localUrl})`));
 assert.match(output,new RegExp(`href="${localUrl.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}" crossorigin="anonymous"`));
 assert.equal(rendered.split(`url(${localUrl})`).length-1,5);
 assert.equal((rendered.match(/font-display: optional/g)||[]).length,20);
 assert.ok(output.indexOf('data-public-font-preload')<output.indexOf('<body>'));
 assert.ok(output.includes('<h1>Find your next home</h1>'));
 for(const url of pinned.uniqueFonts.filter(u=>u!==local.sourceUrl)) assert.equal(rendered.split(`url(${url})`).length-1,5);
});
test('a missing, corrupt or replaced local font retains the original loader and retries after recovery',()=>{
 for(const broken of [null,Buffer.from('wOF2bad'),Buffer.alloc(bytes.length)]){
  let failed=true;const read=(filename,encoding)=>{
   if(filename.endsWith('.css'))return originalCss;
   if(failed){if(broken===null)throw new Error('missing local font');return broken;}return bytes;
  };
  const apply=createPublicFontFaceInliner(read); assert.equal(apply(input),input);failed=false;
  assert.equal(fontStyle(apply(input)),originalCss.replaceAll(`url(${local.sourceUrl})`,`url(${localUrl})`));
 }
});
