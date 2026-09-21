import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const checkScript = readFileSync(new URL("../scripts/check.mjs", import.meta.url), "utf8");

test("npm check delegates to discovery-based syntax and test runner", () => {
  assert.equal(packageJson.scripts.check, "node scripts/check.mjs");
  assert.match(checkScript, /\.test\.mjs/);
  assert.match(checkScript, /--check/);
  assert.match(checkScript, /--test/);
  assert.match(checkScript, /bash/);
  assert.doesNotMatch(packageJson.scripts.check, /server\/|test\//);
});
