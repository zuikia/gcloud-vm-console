import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const docsRoot = path.join(projectRoot, "docs");
const documentationFiles = [
  "PRODUCT.md",
  "PRODUCT.zh-CN.md",
  "DESIGN.md",
  "DESIGN.zh-CN.md",
  "README.md",
  "README.zh-CN.md",
  "SECURITY.md",
  "SECURITY.zh-CN.md",
  "CONTRIBUTING.md",
  "CONTRIBUTING.zh-CN.md",
  "THIRD_PARTY_NOTICES.md",
  "THIRD_PARTY_NOTICES.zh-CN.md",
  "RELEASE_CHECKLIST.md",
  "RELEASE_CHECKLIST.zh-CN.md",
  ...readdirSync(docsRoot)
    .filter((name) => name.endsWith(".md"))
    .map((name) => path.join("docs", name))
];

const forbidden = [
  {
    label: "raw node link",
    pattern: /\b(?:vless|vmess|trojan|ss|hysteria2?|hy2|tuic):\/\/[^\s`]{8,}/i
  },
  {
    label: "live panel URL",
    pattern: /(?:panel URL|面板(?:地址|URL))\s*:\s*https?:\/\/\S+/i
  },
  {
    label: "plaintext credential",
    pattern: /\b(?:password|passwd|token|private[_ -]?key|credential|username)\s*:\s*[A-Za-z0-9][^\s`]*/i
  },
  {
    label: "private key path",
    pattern: /\/Users\/[^/\s]+\/(?:Documents\/)?ssh\/[^\s`]+/i
  }
];

test("authoritative documentation does not retain node links or credential material", () => {
  const violations = [];
  for (const relativePath of documentationFiles) {
    const content = readFileSync(path.join(projectRoot, relativePath), "utf8");
    for (const rule of forbidden) {
      if (rule.pattern.test(content)) violations.push(`${relativePath}: ${rule.label}`);
    }
  }

  assert.deepEqual(violations, []);
});
