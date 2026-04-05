"use strict";

const fs = require("fs");
const sharp = require("sharp");
const { removeBackgroundBuffer } = require("./rembgCore");

const CANVAS = 1024;
const MARGIN = 72;

/**
 * Sharpen + mild contrast for ecommerce output (STEP 6).
 * @param {string} localPath
 */
async function enhanceProductProFile(localPath) {
  const buf = await sharp(localPath)
    .ensureAlpha()
    .png()
    .toBuffer();

  const out = await sharp(buf)
    .normalize()
    .linear(1.06, -10)
    .sharpen({ sigma: 0.8 })
    .png()
    .toBuffer();

  fs.writeFileSync(localPath, out);
}

/**
 * Catalog shot: rembg → white backdrop → centered product + soft tonal polish.
 * @param {Buffer} referenceBuffer
 * @returns {Promise<Buffer>} PNG
 */
async function buildCatalogProductPng(referenceBuffer) {
  const transparent = await removeBackgroundBuffer(referenceBuffer);
  const inner = CANVAS - MARGIN * 2;
  const resized = await sharp(transparent)
    .resize(inner, inner, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([{ input: resized, gravity: "center" }])
    .png()
    .toBuffer();
}

module.exports = { enhanceProductProFile, buildCatalogProductPng };
