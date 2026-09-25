// The scripts that make up the page parser, in load order: the shared core,
// one profile per supported site, then the extractor that picks a profile.
// The popup and the save shortcut inject these into the active tab; the
// manifest's content_scripts list must stay in step (tests/manifest.test.mjs).
export const PARSER_FILES = Object.freeze([
  "lib/parser-core.js",
  "lib/site-parsers/royalroad.js",
  "lib/site-parsers/patreon.js",
  "lib/site-parsers/wuxiaworld.js",
  "lib/site-parsers/novelbin.js",
  "lib/site-parsers/scribblehub.js",
  "lib/site-parsers/creativenovels.js",
  "lib/site-parsers/lightnovelstranslations.js",
  "lib/site-parsers/shintranslations.js",
  "lib/site-parsers/chikari.js",
  "lib/site-parsers/archiveofourown.js",
  "lib/site-parsers/wattpad.js",
  "lib/site-parsers/webnovel.js",
  "lib/site-parsers/novelfire.js",
  "lib/site-parsers/readnovelfull.js",
  "lib/page-metadata.js"
]);
