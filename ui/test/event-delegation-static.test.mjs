import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("dynamic resource and task rows use one delegated interaction handler", () => {
  assert.doesNotMatch(app, /function bindResourceRows\(/);
  assert.doesNotMatch(app, /function bindTaskRows\(/);
  assert.match(app, /function handleDelegatedRowInteraction\(/);
  assert.match(app, /document\.addEventListener\("click", handleDelegatedRowInteraction\)/);
  assert.match(app, /document\.addEventListener\("keydown", handleDelegatedRowInteraction\)/);
});
