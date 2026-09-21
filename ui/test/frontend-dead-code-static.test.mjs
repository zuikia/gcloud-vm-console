import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("frontend removes superseded standalone catalog loaders", () => {
  assert.doesNotMatch(app, /function loadRegionCatalog\(/);
  assert.doesNotMatch(app, /function loadFreeRules\(/);
});

test("stylesheet removes verified obsolete pre-distillation selectors", () => {
  for (const className of [
    "button-grid",
    "compact-grid",
    "context-panel",
    "detail-section",
    "detail-section-heading",
    "link-row-heading",
    "log-panel-body",
    "log-toolbar",
    "subsection-heading",
    "summary-hint",
    "verification-checked",
    "verification-grid",
    "verification-result",
    "verification-row",
    "verification-section",
    "verification-summary"
  ]) {
    assert.doesNotMatch(styles, new RegExp(`\\.${className}\\b`), `${className} should not remain in active CSS`);
  }
});
