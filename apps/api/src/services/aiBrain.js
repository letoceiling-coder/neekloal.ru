"use strict";

/**
 * aiBrain.js — deterministic prompt analyzer.
 *
 * Detects content type, suggests style, composition hint, and optimal
 * aspect ratio — all locally with zero latency.
 *
 * Used by the image pipeline when smartMode is enabled, before the LLM
 * enhancer runs, so the enhancer receives richer context.
 */

// ── Keyword maps ──────────────────────────────────────────────────────────────

const TYPE_RULES = [
  {
    type: "character",
    keywords: [
      "человек", "woman", "man", "girl", "boy", "женщина", "мужчина", "девушка",
      "парень", "ребёнок", "child", "warrior", "soldier", "knight", "wizard",
      "hero", "герой", "персонаж", "character", "portrait", "портрет", "лицо",
      "face", "person", "люди", "people", "princess", "queen", "king", "witch",
      "elf", "dwarf", "ninja", "samurai", "astronaut",
    ],
  },
  {
    type: "animal",
    keywords: [
      "cat", "dog", "кот", "собака", "кошка", "животное", "animal", "wolf",
      "волк", "fox", "лиса", "bear", "медведь", "lion", "тигр", "tiger", "bird",
      "птица", "horse", "лошадь", "dragon", "дракон", "creature", "существо",
      "rabbit", "кролик", "deer", "олень", "fish", "рыба",
    ],
  },
  {
    type: "landscape",
    keywords: [
      "landscape", "пейзаж", "mountain", "гора", "forest", "лес", "ocean",
      "море", "sea", "lake", "озеро", "river", "река", "desert", "пустыня",
      "sky", "небо", "sunset", "закат", "sunrise", "рассвет", "nature",
      "природа", "field", "поле", "valley", "долина", "canyon", "waterfall",
      "водопад", "beach", "пляж", "island", "остров", "snow", "снег",
      "jungle", "джунгли", "cave", "пещера", "cliff", "скала",
    ],
  },
  {
    type: "architecture",
    keywords: [
      "building", "здание", "house", "дом", "castle", "замок", "tower",
      "башня", "bridge", "мост", "cathedral", "church", "храм", "city",
      "город", "street", "улица", "interior", "интерьер", "room", "комната",
      "architecture", "архитектура", "palace", "дворец", "ruins", "руины",
      "skyscraper", "небоскрёб", "temple", "alley", "переулок",
    ],
  },
  {
    type: "product",
    keywords: [
      "product", "товар", "bottle", "бутылка", "box", "коробка", "package",
      "упаковка", "label", "этикетка", "perfume", "духи", "phone", "телефон",
      "laptop", "ноутбук", "watch", "часы", "shoes", "обувь", "bag", "сумка",
      "car", "машина", "vehicle", "техника", "gadget", "device", "устройство",
      "jewelry", "украшение", "ring", "кольцо", "cup", "кружка",
    ],
  },
  {
    type: "food",
    keywords: [
      "food", "еда", "dish", "блюдо", "meal", "ужин", "завтрак", "обед",
      "breakfast", "lunch", "dinner", "pizza", "burger", "sushi", "cake",
      "торт", "coffee", "кофе", "tea", "чай", "fruit", "фрукт", "vegetable",
      "овощ", "bread", "хлеб", "pasta", "soup", "суп", "salad", "салат",
      "dessert", "десерт", "cocktail", "коктейль", "wine", "вино",
    ],
  },
  {
    type: "abstract",
    keywords: [
      "abstract", "абстракция", "pattern", "узор", "texture", "текстура",
      "fractal", "фрактал", "digital art", "geometry", "геометрия",
      "mandala", "мандала", "neon", "неон", "glitch", "space", "cosmos",
      "космос", "nebula", "туманность", "galaxy", "галактика", "energy",
      "энергия", "flow", "light", "свет",
    ],
  },
];

// ── Style defaults per type ───────────────────────────────────────────────────

const STYLE_DEFAULTS = {
  character:    "cinematic portrait",
  animal:       "wildlife photography, natural lighting",
  landscape:    "landscape photography, epic, golden hour",
  architecture: "architectural photography, dramatic perspective",
  product:      "product photography, studio lighting, clean background",
  food:         "food photography, appetizing, shallow depth of field",
  abstract:     "digital art, vivid colors, intricate detail",
  unknown:      "cinematic, masterpiece, ultra detailed",
};

// ── Composition defaults per type ─────────────────────────────────────────────

const COMPOSITION_DEFAULTS = {
  character:    "centered portrait, face visible, soft bokeh background",
  animal:       "subject centered, natural environment, eye-level angle",
  landscape:    "wide angle, rule of thirds, expansive horizon",
  architecture: "straight lines, low angle, dramatic sky",
  product:      "centered on white or gradient background, sharp focus",
  food:         "close-up, overhead or 45° angle, styled plating",
  abstract:     "full frame, symmetric or flowing composition",
  unknown:      "balanced composition, centered subject",
};

// ── Aspect ratio defaults per type ───────────────────────────────────────────

const ASPECT_DEFAULTS = {
  character:    { w: 768,  h: 1024 },   // Portrait
  animal:       { w: 1024, h: 1024 },   // Square
  landscape:    { w: 1344, h: 768  },   // Wide 16:9ish
  architecture: { w: 1024, h: 1024 },   // Square or tall
  product:      { w: 1024, h: 1024 },   // Square
  food:         { w: 1024, h: 1024 },   // Square
  abstract:     { w: 1024, h: 1024 },   // Square
  unknown:      { w: 1024, h: 1024 },
};

// ── Quality hints per type ─────────────────────────────────────────────────────

const QUALITY_HINTS = {
  character:    "ultra detailed, 8k, sharp focus, professional photography",
  animal:       "ultra detailed, sharp eyes, 8k, wildlife photography quality",
  landscape:    "ultra detailed, 8k, stunning landscape, masterpiece",
  architecture: "ultra detailed, 8k, architectural render, sharp lines",
  product:      "ultra detailed, studio quality, sharp, commercial photography",
  food:         "appetizing, vibrant colors, professional food photography",
  abstract:     "ultra detailed, vibid colors, fractal quality, 4k",
  unknown:      "ultra detailed, 8k, masterpiece, sharp focus",
};

// ── Core functions ─────────────────────────────────────────────────────────────

/**
 * Detect the content type from prompt text.
 * Returns the type with the most keyword hits.
 */
function detectType(prompt) {
  const lower = prompt.toLowerCase();

  let best = { type: "unknown", score: 0 };
  for (const rule of TYPE_RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) score += 1;
    }
    if (score > best.score) best = { type: rule.type, score };
  }
  return best.type;
}

/**
 * Detect explicit style hints in the prompt.
 * Returns null if none found (caller should use brain.style from type rules).
 */
function detectExplicitStyle(prompt) {
  const lower = prompt.toLowerCase();
  const STYLE_HINTS = [
    "cinematic", "anime", "cartoon", "oil painting", "watercolor", "sketch",
    "photorealistic", "3d render", "pixar", "fantasy", "sci-fi", "noir",
    "vintage", "retro", "minimalist", "surreal", "impressionist",
    "cyberpunk", "steampunk", "vaporwave", "flat design", "illustration",
    "digital art", "concept art", "нуар", "аниме", "акварель",
  ];
  for (const hint of STYLE_HINTS) {
    if (lower.includes(hint)) return hint;
  }
  return null;
}

/**
 * Main analysis function.
 *
 * @param {string} prompt
 * @returns {{
 *   type: string;
 *   style: string;
 *   composition: string;
 *   quality: string;
 *   suggestedSize: { w: number; h: number };
 *   aspectRatioLabel: string;
 *   explicitStyle: string | null;
 * }}
 */
function analyzePrompt(prompt) {
  if (!prompt || typeof prompt !== "string") {
    return {
      type: "unknown",
      style: STYLE_DEFAULTS.unknown,
      composition: COMPOSITION_DEFAULTS.unknown,
      quality: QUALITY_HINTS.unknown,
      suggestedSize: ASPECT_DEFAULTS.unknown,
      aspectRatioLabel: "1:1",
      explicitStyle: null,
    };
  }

  const type = detectType(prompt);
  const explicitStyle = detectExplicitStyle(prompt);
  const style = explicitStyle || STYLE_DEFAULTS[type];
  const composition = COMPOSITION_DEFAULTS[type];
  const quality = QUALITY_HINTS[type];
  const suggestedSize = ASPECT_DEFAULTS[type];
  const { w, h } = suggestedSize;
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(w, h);
  const aspectRatioLabel = `${w / g}:${h / g}`;

  return { type, style, composition, quality, suggestedSize, aspectRatioLabel, explicitStyle };
}

module.exports = { analyzePrompt };
