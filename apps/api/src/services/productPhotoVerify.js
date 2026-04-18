"use strict";

const dns = require("dns").promises;

const MAX_PHOTOS = Number(process.env.PRODUCT_PHOTO_VERIFY_MAX_ITEMS || 24) || 24;
const MAX_IMAGE_BYTES = Number(process.env.PRODUCT_PHOTO_VERIFY_MAX_BYTES || 8 * 1024 * 1024) || 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = Number(process.env.PRODUCT_PHOTO_VERIFY_FETCH_MS || 15_000) || 15_000;
const DEFAULT_CONCURRENCY = Math.min(
  6,
  Math.max(1, Number(process.env.PRODUCT_PHOTO_VERIFY_CONCURRENCY || 3) || 3)
);
const DEFAULT_MIN_CONF = Number(process.env.PRODUCT_PHOTO_VERIFY_MIN_CONFIDENCE || 0.55) || 0.55;
const VISION_MODEL = String(process.env.VISION_MODEL || "llava:latest").trim() || "llava:latest";
const ALLOW_HTTP = String(process.env.PRODUCT_PHOTO_VERIFY_ALLOW_HTTP || "") === "1";
/** Max chars of description sent to the model (marketing text confuses color checks). */
const MAX_DESC_CHARS = Number(process.env.PRODUCT_PHOTO_VERIFY_DESC_MAX || 1800) || 1800;

function getOllamaChatUrl() {
  const base = process.env.OLLAMA_URL;
  if (!base) throw new Error("OLLAMA_URL is not set");
  return `${base.replace(/\/$/, "")}/api/chat`;
}

/**
 * @param {string} host
 * @returns {boolean}
 */
function isIpv4Literal(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/**
 * @param {string} ip
 * @returns {boolean} true if acceptable for outbound fetch (public)
 */
function isPublicIpv4(ip) {
  const p = ip.split(".").map((x) => Number(x));
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  if (a === 0 || a === 10) return false;
  if (a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a >= 224) return false;
  return true;
}

/**
 * @param {string} ip
 * @returns {boolean}
 */
function isPublicIpv6(ip) {
  const x = ip.toLowerCase();
  if (x === "::1") return false;
  if (x.startsWith("fe80:")) return false;
  if (x.startsWith("fc") || x.startsWith("fd")) return false;
  if (x.startsWith("ff")) return false;
  if (x === "::") return false;
  return true;
}

/**
 * @param {string} host
 * @returns {boolean}
 */
function isBlockedHostname(host) {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "metadata.google.internal") return true;
  if (isIpv4Literal(h)) return !isPublicIpv4(h);
  if (h.includes(":") && !h.includes("[")) {
    return !isPublicIpv6(h);
  }
  return false;
}

/**
 * Optional comma-separated suffixes or exact hosts (case-insensitive).
 * If set, hostname must equal one entry or end with ".suffix".
 * @returns {string[] | null}
 */
function hostAllowlist() {
  const raw = process.env.PRODUCT_PHOTO_VERIFY_HOST_ALLOWLIST;
  if (raw == null || String(raw).trim() === "") return null;
  return String(raw)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * @param {string} hostname
 * @param {string[] | null} list
 */
function hostMatchesAllowlist(hostname, list) {
  if (!list || list.length === 0) return true;
  const h = hostname.toLowerCase();
  return list.some((rule) => h === rule || h.endsWith(`.${rule}`));
}

/**
 * @param {string} hostname
 */
async function assertDnsNotPrivate(hostname) {
  if (isIpv4Literal(hostname) || hostname.includes(":")) return;
  const addrs = [];
  try {
    addrs.push(...(await dns.resolve4(hostname)));
  } catch {
    /* ignore */
  }
  try {
    addrs.push(...(await dns.resolve6(hostname)));
  } catch {
    /* ignore */
  }
  if (addrs.length === 0) {
    throw new Error("DNS: host has no A/AAAA records");
  }
  for (const ip of addrs) {
    if (isIpv4Literal(ip)) {
      if (!isPublicIpv4(ip)) throw new Error("DNS: resolves to private IPv4");
    } else if (!isPublicIpv6(ip)) {
      throw new Error("DNS: resolves to non-public IPv6");
    }
  }
}

/**
 * @param {string} urlStr
 * @returns {Promise<void>}
 */
async function assertUrlAllowed(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "https:" && !(ALLOW_HTTP && u.protocol === "http:")) {
    throw new Error(`Only ${ALLOW_HTTP ? "http or " : ""}https URLs are allowed`);
  }
  if (isBlockedHostname(u.hostname)) {
    throw new Error("Host is not allowed");
  }
  const list = hostAllowlist();
  if (!hostMatchesAllowlist(u.hostname, list)) {
    throw new Error("Host is not in PRODUCT_PHOTO_VERIFY_HOST_ALLOWLIST");
  }
  if (String(process.env.PRODUCT_PHOTO_VERIFY_DNS_CHECK || "1") !== "0") {
    await assertDnsNotPrivate(u.hostname);
  }
}

/**
 * @param {string} urlStr
 * @returns {Promise<string>} raw base64 (no data: prefix)
 */
async function fetchImageAsBase64(urlStr) {
  await assertUrlAllowed(urlStr);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(urlStr, {
      method: "GET",
      redirect: "follow",
      signal: ac.signal,
      headers: {
        "User-Agent": "site-al-product-photo-verify/1",
        Accept: "image/*,*/*;q=0.8",
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!ct.startsWith("image/")) {
      throw new Error(`Unexpected content-type: ${ct || "none"}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) {
      throw new Error(`Image too large (>${MAX_IMAGE_BYTES} bytes)`);
    }
    if (buf.length < 32) {
      throw new Error("Image too small or empty");
    }
    return buf.toString("base64");
  } finally {
    clearTimeout(t);
  }
}

/**
 * @param {string} text
 * @returns {object | null}
 */
/**
 * @param {string | null | undefined} d
 * @param {number} maxLen
 */
function truncateDescription(d, maxLen) {
  if (d == null || !String(d).trim()) return null;
  const t = String(d).trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}\n…`;
}

function tryParseModelJson(text) {
  if (!text || typeof text !== "string") return null;
  let s = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(s);
  if (fence) s = fence[1].trim();
  const objMatch = /\{[\s\S]*\}/.exec(s);
  if (objMatch) s = objMatch[0];
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   productName: string,
 *   description?: string | null,
 *   color?: string | null,
 *   imageBase64: string,
 *   minConfidence: number,
 *   language: string,
 *   strictColorMatch: boolean,
 * }} p
 */
async function callVisionOnce(p) {
  const { productName, description, color, imageBase64, minConfidence, language, strictColorMatch } = p;

  const descShort = truncateDescription(description, MAX_DESC_CHARS);

  const useColorGate = Boolean(color) && strictColorMatch;

  const system = useColorGate
    ? [
        "You are a strict marketplace photo moderator.",
        "Output exactly ONE JSON object. No markdown fences. No text before/after JSON.",
        'Schema: {"dominant_visible_colors":string[],"matches_declared_color":boolean,"match":boolean,"confidence":number,"issues":string[]}',
        "dominant_visible_colors: 1-3 main garment colors you see (Russian or English words).",
        "matches_declared_color: true ONLY if the main garment color matches the DECLARED color for this listing.",
        "CRITICAL: Description text may say the seller offers many colors (e.g. 'не только коричневый', 'другие цвета'). IGNORE that for this task — it describes the catalog, not whether THIS photo matches THIS listing color.",
        `Declared listing color is authoritative. If the dress/outfit in the photo is clearly a different main color than declared (e.g. declared brown but dress is red/white/blue/pink/black/green/grey as the main color), matches_declared_color MUST be false.`,
        "Brown (коричневый) includes natural brown shades (coffee, chocolate, tan, camel). It does NOT include red, crimson, white, black, blue, pink, mint, etc. as the dominant dress color.",
        "Logos, business cards, hangers-only, or images where the garment is not the main subject → match false, matches_declared_color false.",
        "match: true ONLY if this is clearly the same product type as the title AND matches_declared_color is true AND the image is a proper product photo.",
        `confidence: 0..1. If uncertain, set match false and confidence below ${minConfidence}.`,
        `issues: short strings, language=${language} (empty array if none).`,
      ].join("\n")
    : [
        "You are a strict product-photo auditor for e-commerce.",
        "Answer ONLY with a single JSON object, no markdown, no extra text.",
        `Schema: {"match":boolean,"confidence":number,"issues":string[]}`,
        "- match: true only if the image clearly depicts this product.",
        "- confidence: 0..1 (how sure you are).",
        `- issues: short strings in language=${language} (empty array if none).`,
        `If uncertain or image is irrelevant, set match false and confidence below ${minConfidence}.`,
      ].join(" ");

  const userText = useColorGate
    ? [
        `Product name: ${productName}`,
        `Declared color (AUTHORITATIVE for this listing): ${color}`,
        descShort
          ? `Description (truncated; do NOT use it to justify other colors for this SKU):\n${descShort}`
          : null,
        "Look at the image. Fill dominant_visible_colors, matches_declared_color, match, confidence, issues.",
      ]
        .filter(Boolean)
        .join("\n\n")
    : [
        `Product name: ${productName}`,
        descShort ? `Description: ${descShort}` : null,
        color ? `Declared color: ${color}` : null,
        "Does this image match the product card?",
      ]
        .filter(Boolean)
        .join("\n");

  const body = {
    model: VISION_MODEL,
    stream: false,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: userText,
        images: [imageBase64],
      },
    ],
    options: { temperature: 0.05, num_predict: 768 },
  };

  const ollamaRes = await fetch(getOllamaChatUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!ollamaRes.ok) {
    const err = await ollamaRes.text();
    throw new Error(`Vision model HTTP ${ollamaRes.status}: ${err.slice(0, 400)}`);
  }

  const data = await ollamaRes.json();
  const content = data.message?.content ?? "";
  const parsed = tryParseModelJson(content);
  if (!parsed || typeof parsed.match !== "boolean") {
    return {
      match: false,
      confidence: 0,
      issues: [language === "ru" ? "Некорректный ответ модели" : "Invalid model response"],
      rawSnippet: content.slice(0, 200),
      matchesDeclaredColor: null,
      dominantVisibleColors: null,
    };
  }

  let confidence = Number(parsed.confidence);
  if (Number.isNaN(confidence)) confidence = parsed.match ? 0.7 : 0.3;
  confidence = Math.max(0, Math.min(1, confidence));

  let issues = Array.isArray(parsed.issues)
    ? parsed.issues.map((x) => String(x)).filter(Boolean)
    : [];

  let match = parsed.match === true;
  /** @type {boolean | null} */
  let matchesDeclaredColor = null;
  /** @type {string[] | null} */
  let dominantVisibleColors = null;

  if (useColorGate) {
    dominantVisibleColors = Array.isArray(parsed.dominant_visible_colors)
      ? parsed.dominant_visible_colors.map((x) => String(x)).filter(Boolean)
      : [];
    if (typeof parsed.matches_declared_color === "boolean") {
      matchesDeclaredColor = parsed.matches_declared_color;
    } else {
      matchesDeclaredColor = null;
    }

    if (matchesDeclaredColor !== true) {
      match = false;
      if (matchesDeclaredColor === false) {
        const hint =
          language === "ru"
            ? "Цвет на фото не соответствует заявленному"
            : "Photo color does not match declared color";
        if (!issues.some((i) => i.includes("цвет") || i.toLowerCase().includes("color"))) {
          issues = [hint, ...issues];
        }
      } else {
        const hint =
          language === "ru"
            ? "Цвет: модель не подтвердила соответствие заявленному"
            : "Color conformance not confirmed by model";
        issues = [hint, ...issues];
      }
    }
  }

  return {
    match,
    confidence,
    issues,
    rawSnippet: null,
    matchesDeclaredColor,
    dominantVisibleColors,
  };
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<void>} worker
 */
async function poolMap(items, concurrency, worker) {
  const q = [...items];
  const runners = new Array(Math.min(concurrency, Math.max(1, q.length))).fill(0).map(async () => {
    while (q.length) {
      const item = q.shift();
      if (!item) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * @param {{
 *   productName: string,
 *   description?: string | null,
 *   color?: string | null,
 *   photos: { url: string, active?: boolean }[],
 *   options?: {
 *     minConfidence?: number,
 *     concurrency?: number,
 *     language?: string,
 *     strictColorMatch?: boolean,
 *   },
 * }} input
 */
async function verifyProductPhotos(input) {
  const productName = String(input.productName || "").trim();
  if (!productName) {
    throw Object.assign(new Error("productName is required"), { statusCode: 400 });
  }

  const description =
    input.description != null && String(input.description).trim()
      ? String(input.description).trim()
      : null;
  const color =
    input.color != null && String(input.color).trim() ? String(input.color).trim() : null;

  const photos = Array.isArray(input.photos) ? input.photos : [];
  if (photos.length === 0) {
    throw Object.assign(new Error("photos must be a non-empty array"), { statusCode: 400 });
  }
  if (photos.length > MAX_PHOTOS) {
    throw Object.assign(new Error(`Too many photos (max ${MAX_PHOTOS})`), { statusCode: 400 });
  }

  const opts = input.options && typeof input.options === "object" ? input.options : {};
  const minConfidence =
    opts.minConfidence != null && !Number.isNaN(Number(opts.minConfidence))
      ? Math.max(0, Math.min(1, Number(opts.minConfidence)))
      : DEFAULT_MIN_CONF;
  const concurrency =
    opts.concurrency != null && !Number.isNaN(Number(opts.concurrency))
      ? Math.min(6, Math.max(1, Number(opts.concurrency)))
      : DEFAULT_CONCURRENCY;
  const language = opts.language === "en" ? "en" : "ru";

  const strictColorMatch =
    color && opts.strictColorMatch === false ? false : Boolean(color);

  /** @type {{ url: string, active: boolean, match: boolean, confidence: number, issues: string[], error?: string, matchesDeclaredColor?: boolean | null, dominantVisibleColors?: string[] }[]} */
  const results = photos.map((p) => {
    const url = p && typeof p.url === "string" ? p.url.trim() : "";
    return {
      url,
      active: true,
      match: false,
      confidence: 0,
      issues: [],
      error: !url ? "missing_url" : undefined,
    };
  });

  await poolMap(
    results,
    concurrency,
    async (row) => {
      if (row.error) {
        row.active = false;
        row.issues = [language === "ru" ? "Нет URL" : "Missing url"];
        return;
      }
      try {
        await assertUrlAllowed(row.url);
      } catch (e) {
        row.active = false;
        row.error = "url_not_allowed";
        row.issues = [e instanceof Error ? e.message : String(e)];
        return;
      }

      let b64;
      try {
        b64 = await fetchImageAsBase64(row.url);
      } catch (e) {
        row.active = false;
        row.error = "fetch_failed";
        row.issues = [e instanceof Error ? e.message : String(e)];
        return;
      }

      try {
        const v = await callVisionOnce({
          productName,
          description,
          color,
          imageBase64: b64,
          minConfidence,
          language,
          strictColorMatch,
        });
        row.match = v.match;
        row.confidence = v.confidence;
        row.issues = v.issues;
        row.active = v.match === true && v.confidence >= minConfidence;
        if (color && strictColorMatch) {
          row.matchesDeclaredColor = v.matchesDeclaredColor;
          row.dominantVisibleColors = v.dominantVisibleColors ?? undefined;
        }
      } catch (e) {
        row.active = false;
        row.error = "vision_failed";
        row.issues = [e instanceof Error ? e.message : String(e)];
      }
    }
  );

  return {
    productName,
    description,
    color,
    modelUsed: VISION_MODEL,
    minConfidence,
    strictColorMatch: color ? strictColorMatch : undefined,
    photos: results,
  };
}

module.exports = {
  verifyProductPhotos,
  MAX_PHOTOS,
  VISION_MODEL,
};
