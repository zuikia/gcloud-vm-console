import assert from "node:assert/strict";
import test from "node:test";

import { copyText } from "../public/lib/copy-text.js";

function fakeDocument({ execResult = true } = {}) {
  const body = {
    appended: [],
    appendChild(node) { this.appended.push(node); },
    removeChild(node) { this.appended = this.appended.filter((item) => item !== node); }
  };
  return {
    body,
    createElement(tag) {
      return {
        tag,
        style: {},
        value: "",
        setAttribute(name, value) { this[name] = value; },
        select() { this.selected = true; },
        remove() { this.removed = true; }
      };
    },
    execCommand(command) {
      return command === "copy" && execResult;
    }
  };
}

test("copyText uses navigator clipboard when available", async () => {
  const calls = [];
  const result = await copyText("hello", {
    navigator: { clipboard: { writeText: async (value) => calls.push(value) } },
    document: fakeDocument()
  });
  assert.deepEqual(calls, ["hello"]);
  assert.deepEqual(result, { ok: true, method: "clipboard" });
});

test("copyText falls back to hidden textarea when clipboard is denied", async () => {
  const doc = fakeDocument();
  const result = await copyText("fallback text", {
    navigator: { clipboard: { writeText: async () => { throw new Error("denied"); } } },
    document: doc
  });
  assert.deepEqual(result, { ok: true, method: "fallback" });
  assert.equal(doc.body.appended.length, 0);
});

test("copyText reports failure when both methods fail", async () => {
  const result = await copyText("cannot copy", {
    navigator: { clipboard: { writeText: async () => { throw new Error("denied"); } } },
    document: fakeDocument({ execResult: false })
  });
  assert.equal(result.ok, false);
  assert.equal(result.method, "failed");
  assert.match(result.error, /copy failed/i);
});
