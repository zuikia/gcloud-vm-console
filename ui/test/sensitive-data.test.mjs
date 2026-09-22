import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeJobResult, sanitizeNodeResult } from "../server/sensitive-data.js";

test("sensitive panel credentials are replaced by a non-secret availability marker", () => {
  const result = sanitizeNodeResult({
    type: "three_x_ui",
    panel: {
      url: "https://panel.example",
      username: "admin",
      password: "raw-panel-password",
      apiToken: "raw-api-token"
    }
  });

  assert.equal(result.panel.credentialsAvailable, true);
  assert.equal(Object.hasOwn(result.panel, "password"), false);
  assert.equal(Object.hasOwn(result.panel, "apiToken"), false);
});

test("job result sanitization covers the direct node result payload", () => {
  const result = sanitizeJobResult({
    nodeResult: { panel: { username: "admin", password: "raw-panel-password" } }
  });

  assert.equal(result.nodeResult.panel.credentialsAvailable, true);
  assert.doesNotMatch(JSON.stringify(result), /raw-panel-password/);
});
