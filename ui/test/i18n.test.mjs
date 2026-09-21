import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateText } from "../public/lib/i18n.js";

test("i18n translates core navigation and preserves technical literals", () => {
  const translated = translateText("总览 · 实例 · 部署 · 任务 / gcloud compute instances list", "en-US");
  assert.equal(translated, "Overview · Instances · Deploy · Tasks / gcloud compute instances list");
});

test("i18n translates dynamic counts and status phrases", () => {
  const translated = translateText("3 个问题 · 2 个可用区 · 4 条节点链接 · 15 分钟前", "en-US");
  assert.equal(translated, "3 issues · 2 zones · 4 node links · 15 min ago");
});

test("i18n can switch English copy back to Chinese", () => {
  const translated = translateText("Overview · No instance selected · 3 issues", "zh-CN");
  assert.equal(translated, "总览 · 尚未选择实例 · 3 个问题");
});

test("i18n does not alter IDs, URLs, ports, or command names", () => {
  const value = "example-project / 203.0.113.10 / TCP 45400 / gcloud compute instances describe";
  assert.equal(translateText(value, "en-US"), value);
});

test("i18n translates dynamic aria, title, and placeholder copy as complete phrases", () => {
  const translated = translateText(
    "技术详情摘要 | 需要先在实例页选择一台实例。 | 云端删除流程当前未开放。 | 例如 ~/.ssh/google_compute_engine",
    "en-US"
  );
  assert.equal(
    translated,
    "Technical details summary | Select an instance from the Instances page first. | Cloud deletion is not currently available. | For example, ~/.ssh/google_compute_engine"
  );
  assert.doesNotMatch(translated, /[\u4e00-\u9fff]/);
});

test("i18n translates every static Chinese text node in the public shell", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const nodes = [...html.matchAll(/>([^<>]*[\u4e00-\u9fff][^<>]*)</g)].map((match) => match[1].trim()).filter(Boolean);
  const untranslated = nodes
    .map((source) => ({ source, translated: translateText(source, "en-US") }))
    .filter(({ source, translated }) => /[\u4e00-\u9fff]/.test(translated) && translated !== source);
  assert.deepEqual(untranslated, [], `static copy still mixes Chinese into English: ${JSON.stringify(untranslated)}`);
});
