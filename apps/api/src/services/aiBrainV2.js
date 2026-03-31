"use strict";

/**
 * aiBrainV2.js — расширенный детерминированный анализатор промптов.
 *
 * Стратегия: priority-based detection — более специфичные паттерны
 * проверяются РАНЬШЕ более общих, что исключает ложные срабатывания.
 * Пример: "кот в сапогах" → character (priority), не animal (score).
 */

// ── Type definitions ─────────────────────────────────────────────────────────

const TYPES = {
  character:    "Персонаж",
  animal:       "Животное",
  landscape:    "Пейзаж",
  architecture: "Архитектура",
  product:      "Продукт",
  food:         "Еда",
  abstract:     "Абстракция",
  banner:       "Баннер",
  logo:         "Логотип",
  ui:           "UI / Интерфейс",
  unknown:      "Общее",
};

// ── Priority-based type detection ─────────────────────────────────────────────
//
// Проверяется в ПОРЯДКЕ ПРИОРИТЕТА.
// Первый совпавший блок выигрывает.
// Это решает проблему "кот в сапогах" → character (не animal).

const PRIORITY_RULES = [
  // ── UI / Tech
  {
    type: "ui",
    test: (p) =>
      p.includes("ui ") || p.includes(" ui") || p.includes("интерфейс") ||
      p.includes("дашборд") || p.includes("dashboard") || p.includes("мобильное приложение") ||
      p.includes("app screen") || p.includes("веб-приложение") || p.includes("сайт дизайн") ||
      p.includes("website design"),
  },
  // ── Logo
  {
    type: "logo",
    test: (p) =>
      p.includes("логотип") || p.includes("logo") || p.includes("эмблема") ||
      p.includes("иконка приложения") || p.includes("app icon") || p.includes("brand mark"),
  },
  // ── Banner
  {
    type: "banner",
    test: (p) =>
      p.includes("баннер") || p.includes("banner") || p.includes("обложка") ||
      p.includes("постер") || p.includes("poster") || p.includes("реклама") ||
      p.includes("advertisement") || p.includes("флаер") || p.includes("flyer"),
  },
  // ── Character (ПЕРЕД animal — фказочные/одетые животные = character)
  {
    type: "character",
    test: (p) =>
      p.includes("персонаж") || p.includes("герой") || p.includes("character") ||
      p.includes("portrait") || p.includes("портрет") || p.includes("в одежде") ||
      p.includes("в сапогах") || p.includes("в шляпе") || p.includes("в костюме") ||
      p.includes("в стиле") || p.includes("warrior") || p.includes("soldier") ||
      p.includes("knight") || p.includes("wizard") || p.includes("witch") ||
      p.includes("ninja") || p.includes("samurai") || p.includes("superhero") ||
      p.includes("astronaut") || p.includes("elf") || p.includes("dwarf") ||
      p.includes("princess") || p.includes("queen") || p.includes("king") ||
      p.includes("woman") || p.includes("man ") || p.includes("girl") || p.includes("boy") ||
      p.includes("женщина") || p.includes("мужчина") || p.includes("девушка") ||
      p.includes("парень") || p.includes("человек") || p.includes("лицо") ||
      p.includes("люди") || p.includes("person") || p.includes("face"),
  },
  // ── Food
  {
    type: "food",
    test: (p) =>
      p.includes("еда") || p.includes("food") || p.includes("блюдо") || p.includes("dish") ||
      p.includes("пицца") || p.includes("pizza") || p.includes("бургер") || p.includes("burger") ||
      p.includes("суши") || p.includes("sushi") || p.includes("торт") || p.includes("cake") ||
      p.includes("кофе") || p.includes("coffee") || p.includes("завтрак") || p.includes("breakfast") ||
      p.includes("обед") || p.includes("lunch") || p.includes("ужин") || p.includes("dinner") ||
      p.includes("салат") || p.includes("суп") || p.includes("десерт") || p.includes("dessert") ||
      p.includes("коктейль") || p.includes("cocktail") || p.includes("вино") || p.includes("wine") ||
      p.includes("фрукт") || p.includes("fruit") || p.includes("хлеб") || p.includes("bread"),
  },
  // ── Architecture
  {
    type: "architecture",
    test: (p) =>
      p.includes("здание") || p.includes("building") || p.includes("замок") || p.includes("castle") ||
      p.includes("башня") || p.includes("tower") || p.includes("мост") || p.includes("bridge") ||
      p.includes("храм") || p.includes("church") || p.includes("cathedral") ||
      p.includes("город") || p.includes("city") || p.includes("улица") || p.includes("street") ||
      p.includes("интерьер") || p.includes("interior") || p.includes("комната") || p.includes("room") ||
      p.includes("архитектура") || p.includes("architecture") || p.includes("дворец") || p.includes("palace") ||
      p.includes("небоскрёб") || p.includes("skyscraper") || p.includes("руины") || p.includes("ruins"),
  },
  // ── Product
  {
    type: "product",
    test: (p) =>
      p.includes("айфон") || p.includes("iphone") || p.includes("продукт") || p.includes("product") ||
      p.includes("товар") || p.includes("бутылка") || p.includes("bottle") ||
      p.includes("упаковка") || p.includes("package") || p.includes("духи") || p.includes("perfume") ||
      p.includes("телефон") || p.includes("phone") || p.includes("ноутбук") || p.includes("laptop") ||
      p.includes("часы") || p.includes("watch") || p.includes("обувь") || p.includes("shoes") ||
      p.includes("машина") || p.includes("car") || p.includes("гаджет") || p.includes("gadget") ||
      p.includes("украшение") || p.includes("jewelry") || p.includes("кольцо") || p.includes("ring"),
  },
  // ── Landscape
  {
    type: "landscape",
    test: (p) =>
      p.includes("пейзаж") || p.includes("landscape") || p.includes("гора") || p.includes("горы") ||
      p.includes("mountain") || p.includes("лес") || p.includes("forest") ||
      p.includes("море") || p.includes("ocean") || p.includes("sea") ||
      p.includes("озеро") || p.includes("lake") || p.includes("река") || p.includes("river") ||
      p.includes("пустыня") || p.includes("desert") || p.includes("небо") || p.includes("sky") ||
      p.includes("закат") || p.includes("sunset") || p.includes("рассвет") || p.includes("sunrise") ||
      p.includes("природа") || p.includes("nature") || p.includes("поле") || p.includes("field") ||
      p.includes("водопад") || p.includes("waterfall") || p.includes("пляж") || p.includes("beach") ||
      p.includes("джунгли") || p.includes("jungle") || p.includes("снег") || p.includes("snow"),
  },
  // ── Animal (после character — "кот в сапогах" уже перехвачен выше)
  {
    type: "animal",
    test: (p) =>
      p.includes("кот") || p.includes("кошка") || p.includes("cat") ||
      p.includes("собака") || p.includes("dog") || p.includes("волк") || p.includes("wolf") ||
      p.includes("лиса") || p.includes("fox") || p.includes("медведь") || p.includes("bear") ||
      p.includes("тигр") || p.includes("tiger") || p.includes("lion") || p.includes("лев") ||
      p.includes("птица") || p.includes("bird") || p.includes("лошадь") || p.includes("horse") ||
      p.includes("дракон") || p.includes("dragon") || p.includes("животное") || p.includes("animal") ||
      p.includes("кролик") || p.includes("rabbit") || p.includes("олень") || p.includes("deer") ||
      p.includes("рыба") || p.includes("fish") || p.includes("панда") || p.includes("panda"),
  },
  // ── Abstract (fallback перед unknown)
  {
    type: "abstract",
    test: (p) =>
      p.includes("абстракция") || p.includes("abstract") || p.includes("узор") || p.includes("pattern") ||
      p.includes("фрактал") || p.includes("fractal") || p.includes("цифровое искусство") ||
      p.includes("digital art") || p.includes("неон") || p.includes("neon") ||
      p.includes("космос") || p.includes("space") || p.includes("галактика") || p.includes("galaxy") ||
      p.includes("мандала") || p.includes("mandala") || p.includes("геометрия") || p.includes("geometry"),
  },
];

// ── Style intelligence ────────────────────────────────────────────────────────
//
// Явные стилевые маркеры в промпте — всегда побеждают дефолт по типу.

const STYLE_OVERRIDE_RULES = [
  { test: (p) => p.includes("аниме") || p.includes("anime"),             style: "anime style, vibrant colors" },
  { test: (p) => p.includes("3d") || p.includes("трёхмерный"),           style: "3D render, octane render" },
  { test: (p) => p.includes("акварель") || p.includes("watercolor"),     style: "watercolor painting, soft colors" },
  { test: (p) => p.includes("реалистичный") || p.includes("realistic") ||
                 p.includes("реализм") || p.includes("photorealistic"),   style: "photorealistic, hyperrealistic" },
  { test: (p) => p.includes("масляная") || p.includes("oil painting"),   style: "oil painting, classic art" },
  { test: (p) => p.includes("карандаш") || p.includes("sketch") ||
                 p.includes("pencil"),                                    style: "pencil sketch, detailed linework" },
  { test: (p) => p.includes("пиксар") || p.includes("pixar"),            style: "Pixar 3D style, colorful" },
  { test: (p) => p.includes("киберпанк") || p.includes("cyberpunk"),     style: "cyberpunk, neon lights, dark city" },
  { test: (p) => p.includes("фэнтези") || p.includes("fantasy"),        style: "fantasy art, epic, magical" },
  { test: (p) => p.includes("минимал") || p.includes("minimal"),        style: "minimalist, clean, simple" },
  { test: (p) => p.includes("винтаж") || p.includes("vintage") ||
                 p.includes("ретро") || p.includes("retro"),             style: "vintage, retro style, film grain" },
];

// ── Mode detection ────────────────────────────────────────────────────────────

function detectMode(prompt, flags = {}) {
  const p = prompt.toLowerCase();

  if (p.includes("варианты") || p.includes("несколько") || p.includes("variations") ||
      p.includes("multiple") || p.includes("different versions")) return "variation";

  if (flags.referenceImage) return "reference";
  if (flags.mask) return "inpaint";
  if (flags.enableVariations) return "variation";

  return "text";
}

// ── Defaults by type ──────────────────────────────────────────────────────────

const STYLE_DEFAULTS = {
  character:    "cinematic portrait",
  animal:       "wildlife photography, natural lighting",
  landscape:    "epic landscape, golden hour",
  architecture: "architectural photography, dramatic perspective",
  product:      "studio product photography, clean background",
  food:         "food photography, styled, appetizing",
  abstract:     "digital art, vivid colors, intricate detail",
  banner:       "modern marketing banner, clean UI, bold typography",
  logo:         "minimalist logo design, vector style, clean",
  ui:           "modern UI design, glassmorphism, clean layout",
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
  banner:       "horizontal layout, strong focal point, text-friendly negative space",
  logo:         "centered on white background, balanced proportions",
  ui:           "full-screen mockup, device frame, clean grid layout",
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
  banner:       { w: 1344, h: 768  },
  logo:         { w: 1024, h: 1024 },
  ui:           { w: 1344, h: 768  },
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
  banner:       "high-resolution, crisp text, marketing quality, professional",
  logo:         "vector quality, scalable, crisp edges, professional branding",
  ui:           "pixel-perfect, clean UI, high-fidelity mockup",
  unknown:      "ultra detailed, 8k, masterpiece, sharp focus",
};

const ENHANCER_HINTS = {
  character:    "Focus on face expression, skin details, hair texture. Make the lighting dramatic and moody.",
  animal:       "Emphasize fur or feather texture, sharp eyes, natural environment details.",
  landscape:    "Emphasize atmosphere, light rays, cloud formations, depth layers in the scene.",
  architecture: "Emphasize geometry, material textures, sky drama, time of day lighting.",
  product:      "Clean minimal background, studio-quality light, crisp edges, commercial appeal.",
  food:         "Make the dish look appetizing with fresh colors, garnish detail, perfect plating.",
  abstract:     "Emphasize color harmony, intricate patterns, depth, flowing forms.",
  banner:       "Bold, eye-catching design. Clear visual hierarchy. Strong contrast. Marketing ready.",
  logo:         "Simple, memorable, scalable. Works on both light and dark backgrounds. Timeless.",
  ui:           "Clean, modern interface. Consistent spacing, typography, and color palette.",
  unknown:      "Make it visually striking, well composed, professional quality.",
};

// ── Directives builder ────────────────────────────────────────────────────────
//
// must[]   — обязательны, LLM не может их игнорировать
// should[] — желательны (повышают качество)
// negative[] — добавляются в negative prompt

const GLOBAL_NEGATIVE = [
  "blurry", "low quality", "distorted", "bad anatomy", "extra limbs",
  "extra objects", "deformed", "watermark", "text overlay", "ugly",
  "out of focus", "overexposed", "duplicate", "jpeg artifacts",
];

/**
 * Строит директивы для конкретного типа + специфики промпта.
 *
 * @param {string} type
 * @param {string} prompt  (lowercase)
 * @returns {{ must: string[]; should: string[]; negative: string[]; quality: string[] }}
 */
function buildDirectives(type, prompt) {
  const p = prompt.toLowerCase();
  const must    = [];
  const should  = [];
  const quality = [];
  const negative = [...GLOBAL_NEGATIVE];

  // ── Universal quality (always) ────────────────────────────────────────────
  quality.push("ultra detailed", "high resolution", "sharp focus");

  switch (type) {
    case "character": {
      must.push("character design", "full body", "centered composition", "high detail");
      if (p.includes("кот") || p.includes("cat") || p.includes("животн") || p.includes("animal")) {
        must.push("anthropomorphic", "clear subject");
      }
      if (p.includes("в сапогах") || p.includes("boots") || p.includes("in boots")) {
        must.push("wearing boots");
      }
      if (p.includes("в шляпе") || p.includes("hat") || p.includes("in hat")) {
        must.push("wearing hat");
      }
      if (p.includes("в костюме") || p.includes("suit") || p.includes("armor")) {
        must.push("wearing suit");
      }
      should.push("dramatic lighting", "depth of field");
      quality.push("cinematic lighting", "detailed face", "professional character design");
      negative.push("multiple subjects", "crowded scene");
      break;
    }
    case "logo": {
      must.push("vector logo", "minimalist", "centered", "clean white background");
      should.push("high contrast", "flat design", "scalable");
      quality.push("crisp edges", "vector quality", "professional branding");
      negative.push("photo", "realistic", "gradient", "texture", "face", "person", "complex background");
      break;
    }
    case "banner": {
      must.push("horizontal composition", "marketing banner", "bold typography area");
      should.push("high contrast", "strong focal point", "negative space for text");
      quality.push("high-resolution", "professional print quality", "vivid colors");
      negative.push("cluttered", "too many elements", "small text");
      break;
    }
    case "product": {
      must.push("product photography", "studio lighting", "clean background", "sharp focus");
      should.push("commercial quality", "shadow", "reflection");
      quality.push("studio lighting", "photorealistic", "clean reflections");
      negative.push("person", "hand", "cluttered background", "grain");
      break;
    }
    case "landscape": {
      must.push("wide angle", "rule of thirds", "epic scene");
      should.push("atmosphere", "depth layers", "cinematic composition");
      quality.push("8k", "wide dynamic range", "epic lighting");
      negative.push("person", "building", "urban");
      break;
    }
    case "food": {
      must.push("food photography", "appetizing", "styled plating");
      should.push("shallow depth of field", "top view or 45°", "fresh ingredients");
      quality.push("vibrant colors", "professional food photography", "crisp details");
      negative.push("person", "hand", "raw uncooked", "dirty");
      break;
    }
    case "architecture": {
      must.push("architectural photography", "perspective lines", "dramatic sky");
      should.push("golden hour", "sharp lines", "symmetry");
      quality.push("8k render", "architectural detail", "high dynamic range");
      negative.push("person", "car", "blurry");
      break;
    }
    case "ui": {
      must.push("UI design", "clean layout", "modern interface", "device mockup");
      should.push("glassmorphism", "consistent spacing", "pixel-perfect");
      quality.push("high-fidelity", "retina quality", "professional UI");
      negative.push("person", "realistic photo", "blurry");
      break;
    }
    case "abstract": {
      must.push("full frame", "intricate detail", "vibrant colors");
      should.push("flowing forms", "depth", "color harmony");
      quality.push("4k", "masterpiece", "stunning visuals");
      break;
    }
    default: {
      should.push("cinematic", "masterpiece");
      quality.push("ultra detailed", "8k resolution");
      break;
    }
  }

  process.stdout.write(
    `[brain:directives] type=${type} must=${must.length} should=${should.length}\n`
  );
  process.stdout.write(
    `[brain:quality] type=${type} count=${quality.length}\n`
  );

  return { must, should, negative, quality };
}

// ── Core functions ─────────────────────────────────────────────────────────────

function detectType(prompt) {
  const p = prompt.toLowerCase();
  for (const rule of PRIORITY_RULES) {
    if (rule.test(p)) return rule.type;
  }
  return "unknown";
}

function detectStyle(prompt, userStyle) {
  if (userStyle) return userStyle;
  const p = prompt.toLowerCase();
  for (const rule of STYLE_OVERRIDE_RULES) {
    if (rule.test(p)) return rule.style;
  }
  return null; // caller uses type default
}

function getAspectRatioLabel(w, h) {
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Анализирует промпт и возвращает полную конфигурацию.
 *
 * @param {string} prompt
 * @param {{
 *   enableVariations?: boolean;
 *   referenceImage?: boolean;
 *   mask?: boolean;
 *   userStyle?: string;
 * }} [context]
 */
function analyzePrompt(prompt, context = {}) {
  const fallback = {
    type:                "unknown",
    typeLabel:           TYPES.unknown,
    style:               STYLE_DEFAULTS.unknown,
    composition:         COMPOSITION_DEFAULTS.unknown,
    quality:             QUALITY_HINTS.unknown,
    suggestedMode:       "text",
    enhancedPromptHints: ENHANCER_HINTS.unknown,
    suggestedSize:       SIZE_DEFAULTS.unknown,
    aspectRatioLabel:    "1:1",
    explicitStyle:       null,
  };

  if (!prompt || typeof prompt !== "string") return fallback;

  const type          = detectType(prompt);
  const typeLabel     = TYPES[type] ?? TYPES.unknown;
  const explicitStyle = detectStyle(prompt, context.userStyle ?? null);
  const style         = explicitStyle || STYLE_DEFAULTS[type];
  const composition   = COMPOSITION_DEFAULTS[type];
  const quality       = QUALITY_HINTS[type];
  const suggestedSize = SIZE_DEFAULTS[type] ?? SIZE_DEFAULTS.unknown;
  const { w, h }      = suggestedSize;
  const suggestedMode       = detectMode(prompt, context);
  const enhancedPromptHints = ENHANCER_HINTS[type] ?? ENHANCER_HINTS.unknown;
  const directives          = buildDirectives(type, prompt);

  process.stdout.write(
    `[brainV2] type=${type} (${typeLabel}) style="${style}" mode=${suggestedMode}\n`
  );

  return {
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
    directives,
  };
}

module.exports = { analyzePrompt };
