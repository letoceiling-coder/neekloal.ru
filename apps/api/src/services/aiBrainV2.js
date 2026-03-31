"use strict";

/**
 * aiBrainV2.js — расширенный анализатор промптов.
 *
 * Детерминированный (без LLM). Является супerset aiBrain.js:
 * добавляет suggestedMode, enhancedPromptHints и typeLabel.
 *
 * Используется в image pipeline перед enhancer.
 */

// ── Keyword maps ──────────────────────────────────────────────────────────────

const TYPE_RULES = [
  {
    type: "character",
    label: "Персонаж",
    keywords: [
      "человек", "woman", "man", "girl", "boy", "женщина", "мужчина", "девушка",
      "парень", "ребёнок", "child", "warrior", "soldier", "knight", "wizard",
      "hero", "герой", "персонаж", "character", "portrait", "портрет", "лицо",
      "face", "person", "люди", "people", "princess", "queen", "king", "witch",
      "elf", "dwarf", "ninja", "samurai", "astronaut", "superhero",
    ],
  },
  {
    type: "animal",
    label: "Животное",
    keywords: [
      "cat", "dog", "кот", "собака", "кошка", "животное", "animal", "wolf",
      "волк", "fox", "лиса", "bear", "медведь", "lion", "тигр", "tiger", "bird",
      "птица", "horse", "лошадь", "dragon", "дракон", "creature", "существо",
      "rabbit", "кролик", "deer", "олень", "fish", "рыба", "panda", "панда",
    ],
  },
  {
    type: "landscape",
    label: "Пейзаж",
    keywords: [
      "landscape", "пейзаж", "mountain", "гора", "горы", "forest", "лес", "ocean",
      "море", "sea", "lake", "озеро", "river", "река", "desert", "пустыня",
      "sky", "небо", "sunset", "закат", "sunrise", "рассвет", "nature",
      "природа", "field", "поле", "valley", "долина", "canyon", "waterfall",
      "водопад", "beach", "пляж", "island", "остров", "snow", "снег",
      "jungle", "джунгли", "cave", "пещера", "cliff", "скала",
    ],
  },
  {
    type: "architecture",
    label: "Архитектура",
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
    label: "Продукт",
    keywords: [
      "product", "товар", "bottle", "бутылка", "box", "коробка", "package",
      "упаковка", "label", "этикетка", "perfume", "духи", "phone", "телефон",
      "айфон", "iphone", "laptop", "ноутбук", "watch", "часы", "shoes", "обувь",
      "bag", "сумка", "car", "машина", "vehicle", "gadget", "device", "устройство",
      "jewelry", "украшение", "ring", "кольцо", "cup", "кружка",
    ],
  },
  {
    type: "food",
    label: "Еда",
    keywords: [
      "food", "еда", "dish", "блюдо", "meal", "ужин", "завтрак", "обед",
      "breakfast", "lunch", "dinner", "pizza", "пицца", "burger", "бургер",
      "sushi", "суши", "cake", "торт", "coffee", "кофе", "tea", "чай",
      "fruit", "фрукт", "vegetable", "овощ", "bread", "хлеб", "pasta",
      "soup", "суп", "salad", "салат", "dessert", "десерт", "cocktail",
      "коктейль", "wine", "вино",
    ],
  },
  {
    type: "abstract",
    label: "Абстракция",
    keywords: [
      "abstract", "абстракция", "pattern", "узор", "texture", "текстура",
      "fractal", "фрактал", "digital art", "geometry", "геометрия",
      "mandala", "мандала", "neon", "неон", "glitch", "space", "cosmos",
      "космос", "nebula", "туманность", "galaxy", "галактика", "energy",
      "энергия", "flow", "light", "свет",
    ],
  },
];

// ── Defaults per type ─────────────────────────────────────────────────────────

const STYLE_DEFAULTS = {
  character:    "cinematic portrait",
  animal:       "wildlife photography, natural lighting",
  landscape:    "epic landscape, golden hour",
  architecture: "architectural photography, dramatic perspective",
  product:      "studio product photography, clean background",
  food:         "food photography, styled, appetizing",
  abstract:     "digital art, vivid colors, intricate detail",
  unknown:      "cinematic, masterpiece, ultra detailed",
};

const COMPOSITION_DEFAULTS = {
  character:    "centered portrait, face visible, soft bokeh background, depth of field",
  animal:       "subject centered, natural environment, eye-level angle",
  landscape:    "wide angle, rule of thirds, expansive horizon",
  architecture: "straight perspective lines, low angle, dramatic sky",
  product:      "centered on clean background, sharp focus, studio lighting",
  food:         "top view or 45°, styled plating, shallow depth of field",
  abstract:     "full frame, symmetric or flowing composition",
  unknown:      "balanced composition, centered subject",
};

const SIZE_DEFAULTS = {
  character:    { w: 768,  h: 1024 },
  animal:       { w: 1024, h: 1024 },
  landscape:    { w: 1344, h: 768  },
  architecture: { w: 1024, h: 1024 },
  product:      { w: 1024, h: 1024 },
  food:         { w: 1024, h: 1024 },
  abstract:     { w: 1024, h: 1024 },
  unknown:      { w: 1024, h: 1024 },
};

const QUALITY_HINTS = {
  character:    "ultra detailed, 8k, sharp focus, professional photography",
  animal:       "ultra detailed, sharp eyes, 8k, wildlife photography quality",
  landscape:    "ultra detailed, 8k, stunning landscape, masterpiece",
  architecture: "ultra detailed, 8k, architectural render, sharp lines",
  product:      "ultra detailed, studio quality, sharp, commercial photography",
  food:         "appetizing, vibrant colors, professional food photography",
  abstract:     "ultra detailed, vivid colors, fractal quality, 4k",
  unknown:      "ultra detailed, 8k, masterpiece, sharp focus",
};

/** Hints that go directly into the LLM enhancer system prompt for better output. */
const ENHANCER_HINTS = {
  character:    "Focus on the face expression, skin details, hair texture. Make the lighting dramatic and moody.",
  animal:       "Emphasize fur or feather texture, sharp eyes, natural environment details.",
  landscape:    "Emphasize atmosphere, light rays, cloud formations, depth layers in the scene.",
  architecture: "Emphasize geometry, material textures, sky drama, time of day lighting.",
  product:      "Clean minimal background, studio-quality light, crisp edges, commercial appeal.",
  food:         "Make the dish look appetizing with fresh colors, garnish detail, perfect plating.",
  abstract:     "Emphasize color harmony, intricate patterns, depth, flowing forms.",
  unknown:      "Make it visually striking, well composed, professional quality.",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectType(prompt) {
  const lower = prompt.toLowerCase();
  let best = { type: "unknown", score: 0 };
  for (const rule of TYPE_RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > best.score) best = { type: rule.type, score };
  }
  return best.type;
}

function detectLabel(type) {
  return TYPE_RULES.find((r) => r.type === type)?.label ?? "Общее";
}

function detectExplicitStyle(prompt) {
  const lower = prompt.toLowerCase();
  const STYLE_HINTS = [
    "cinematic", "anime", "cartoon", "oil painting", "watercolor", "sketch",
    "photorealistic", "3d render", "pixar", "fantasy", "sci-fi", "noir",
    "vintage", "retro", "minimalist", "surreal", "impressionist",
    "cyberpunk", "steampunk", "vaporwave", "flat design", "illustration",
    "digital art", "concept art",
  ];
  for (const hint of STYLE_HINTS) {
    if (lower.includes(hint)) return hint;
  }
  return null;
}

function getAspectRatioLabel(w, h) {
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Анализирует промпт и возвращает полную конфигурацию для pipeline.
 *
 * @param {string} prompt
 * @param {{ enableVariations?: boolean }} [context]
 * @returns {{
 *   type: string;
 *   typeLabel: string;
 *   style: string;
 *   composition: string;
 *   quality: string;
 *   suggestedMode: "text" | "variation";
 *   enhancedPromptHints: string;
 *   suggestedSize: { w: number; h: number };
 *   aspectRatioLabel: string;
 *   explicitStyle: string | null;
 * }}
 */
function analyzePrompt(prompt, context = {}) {
  if (!prompt || typeof prompt !== "string") {
    return {
      type:                "unknown",
      typeLabel:           "Общее",
      style:               STYLE_DEFAULTS.unknown,
      composition:         COMPOSITION_DEFAULTS.unknown,
      quality:             QUALITY_HINTS.unknown,
      suggestedMode:       "text",
      enhancedPromptHints: ENHANCER_HINTS.unknown,
      suggestedSize:       SIZE_DEFAULTS.unknown,
      aspectRatioLabel:    "1:1",
      explicitStyle:       null,
    };
  }

  const type          = detectType(prompt);
  const typeLabel     = detectLabel(type);
  const explicitStyle = detectExplicitStyle(prompt);
  const style         = explicitStyle || STYLE_DEFAULTS[type];
  const composition   = COMPOSITION_DEFAULTS[type];
  const quality       = QUALITY_HINTS[type];
  const suggestedSize = SIZE_DEFAULTS[type];
  const { w, h }      = suggestedSize;

  // suggestedMode: variation if caller signals it, otherwise text
  const suggestedMode = context.enableVariations ? "variation" : "text";

  const enhancedPromptHints = ENHANCER_HINTS[type];

  const result = {
    type,
    typeLabel,
    style,
    composition,
    quality,
    suggestedMode,
    enhancedPromptHints,
    suggestedSize,
    aspectRatioLabel: getAspectRatioLabel(w, h),
    explicitStyle,
  };

  process.stdout.write(
    `[brainV2] type=${type} (${typeLabel}) style="${style}" mode=${suggestedMode}\n`
  );

  return result;
}

module.exports = { analyzePrompt };
