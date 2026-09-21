import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const docPath = new URL("../../docs/function-consolidation-audit.md", import.meta.url);

test("function consolidation audit documents duplicate decisions", () => {
  const doc = readFileSync(docPath, "utf8");
  for (const heading of [
    "Intent Groups",
    "Confirmed Merges",
    "Kept Separate",
    "Demoted Actions",
    "No-Go Boundaries",
    "Verification Matrix"
  ]) {
    assert.match(doc, new RegExp(`## ${heading}`));
  }
  assert.match(doc, /刷新数据.*刷新清单/s);
  assert.match(doc, /运行体检.*操作建议.*智能诊断.*接管本地/s);
  assert.match(doc, /删除云端资源.*未开放/s);
  assert.doesNotMatch(doc, /TBD|TODO|待定/);
});
