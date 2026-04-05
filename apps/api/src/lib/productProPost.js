"use strict";

const fs = require("fs");
const sharp = require("sharp");
const { removeBackgroundBuffer } = require("./rembgCore");
const { assertCatalogNoHuman } = require("./humanDetect");

const CANVAS = 1024;
const MARGIN = 72;

/** Premium grade: brightness 1.03, contrast ~1.05, saturation 1.08 (product + catalog). */
const PREMIUM_BRIGHTNESS = 1.03;
const PREMIUM_SATURATION = 1.08;
const PREMIUM_CONTRAST_A = 1.05;
const PREMIUM_CONTRAST_B = -8;

/**
 * E-commerce / catalog final pass (STEP 3 post-process).
 * @param {string} localPath
 */
async function enhanceProductProFile(localPath) {
  const out = await sharp(localPath)
    .ensureAlpha()
    .png()
    .modulate({ brightness: PREMIUM_BRIGHTNESS, saturation: PREMIUM_SATURATION })
    .linear(PREMIUM_CONTRAST_A, PREMIUM_CONTRAST_B)
    .sharpen({ sigma: 0.45 })
    .png()
    .toBuffer();

  fs.writeFileSync(localPath, out);
}

/**
 * Catalog shot: rembg → reject if human (face/body) → white + soft shadow → centered product.
 * @param {Buffer} referenceBuffer
 * @returns {Promise<Buffer>} PNG
 */
async function buildCatalogProductPng(referenceBuffer) {
  const transparent = await removeBackgroundBuffer(referenceBuffer);
  await assertCatalogNoHuman(transparent);

  const inner = CANVAS - MARGIN * 2;
  const resized = await sharp(transparent)
    .resize(inner, inner, { fit: "inside", withoutEnlargement: false })
    .ensureAlpha()
    .png()
    .toBuffer();

  const meta = await sharp(resized).metadata();
  const iw = meta.width || inner;
  const ih = meta.height || inner;
  const left = Math.floor((CANVAS - iw) / 2);
  const top = Math.floor((CANVAS - ih) / 2);

  const shadowBlur = 14;
  const shadowOffset = 5;
  const shadowSrc = await sharp(resized)
    .flatten({ background: { r: 210, g: 210, b: 210 } })
    .blur(shadowBlur)
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
    .composite([
      {
        input: shadowSrc,
        left: Math.max(0, left - shadowBlur / 2),
        top: Math.max(0, top + shadowOffset),
      },
      { input: resized, left, top },
    ])
    .png()
    .toBuffer();
}

/**
 * Model shots: padding + centered subject (STEP 4), then premium grade (STEP 3).
 * Keeps sharpen gentle to reduce plastic-skin look. (STEP 5 “no AI look” is prompt + QC, not auto-rejected here.)
 */
async function enhanceProductProModelFile(localPath) {
  const meta = await sharp(localPath).metadata();
  const w = meta.width || 1024;
  const h = meta.height || 1024;
  const scale = 0.94;
  const tw = Math.round(w * scale);
  const th = Math.round(h * scale);

  const innerBuf = await sharp(localPath)
    .resize(tw, th, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .png()
    .toBuffer();

  const padded = await sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: { r: 250, g: 249, b: 248 },
    },
  })
    .composite([{ input: innerBuf, gravity: "center" }])
    .png()
    .toBuffer();

  const out = await sharp(padded)
    .modulate({ brightness: PREMIUM_BRIGHTNESS, saturation: PREMIUM_SATURATION })
    .linear(PREMIUM_CONTRAST_A, PREMIUM_CONTRAST_B)
    .sharpen({ sigma: 0.28 })
    .png()
    .toBuffer();

  fs.writeFileSync(localPath, out);
}

module.exports = { enhanceProductProFile, enhanceProductProModelFile, buildCatalogProductPng };
