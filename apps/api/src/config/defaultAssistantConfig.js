"use strict";

/**
 * Default assistant config — used when assistant.config is null.
 * Each assistant can override any or all of these keys via the DB config JSON field.
 */
module.exports = {
  /** Intent keyword dictionaries (RU). Keys become intent labels. */
  intents: {
    pricing:            ["цена", "стоимость", "сколько", "бюджет", "ценник"],
    objection:          ["дорого", "дороговато", "слишком дорого"],
    qualification_site: ["сайт", "лендинг", "интернет-магазин", "разработк"],
    close:              ["куплю", "оформ", "оплат", "заключаем", "давайте договор"],
  },

  /** Fields to extract and persist in conversation.context */
  memory: ["budget", "projectType"],

  /** Ordered FSM stages */
  funnel: ["greeting", "qualification", "offer", "objection", "close"],

  /** Heuristic response validation */
  validation: {
    maxSentences: 3,
    questions:    1,
  },
};
