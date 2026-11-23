import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sources = ["home/homeScreen.js", "search/searchScreen.js"].map((path) => [
  path,
  readFileSync(new URL(`./${path}`, import.meta.url), "utf8")
]);

test("catalog row subtitles use the localized catalog_from_addon string", () => {
  for (const [path, source] of sources) {
    assert.ok(
      source.includes('I18n.t("catalog_from_addon"'),
      `${path} should use catalog_from_addon`
    );
    assert.doesNotMatch(source, /\?\s*`from \$\{/, `${path} still hardcodes "from <addon>"`);
  }
});

test("every locale defines catalog_from_addon with the addon placeholder", () => {
  const resDir = new URL("../../../res/", import.meta.url);
  const locales = ["values", "values-fr", "values-de", "values-es", "values-pt-br"];
  for (const locale of locales) {
    const xml = readFileSync(new URL(`${locale}/strings.xml`, resDir), "utf8");
    const match = xml.match(/<string name="catalog_from_addon">([^<]*)<\/string>/);
    assert.ok(match, `${locale} is missing catalog_from_addon`);
    assert.match(match[1], /%1\$s/, `${locale} catalog_from_addon lacks %1$s`);
  }
});
