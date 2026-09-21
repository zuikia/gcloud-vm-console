import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pairs = [
  {
    base: "README",
    required: ["npm --prefix ui ci", "npm --prefix ui run check", "npm --prefix ui run audit:layout", "docs/demo/workbench-1440.png"]
  },
  {
    base: "SECURITY",
    required: ["gcloud", "SSH", ".gcp-vm-console/"]
  },
  {
    base: "CONTRIBUTING",
    required: ["npm --prefix ui ci", "npm --prefix ui run check", ".gcp-vm-console/"]
  },
  {
    base: "THIRD_PARTY_NOTICES",
    required: ["playwright", "@fontsource-variable/ibm-plex-sans", "ui/package-lock.json"]
  },
  {
    base: "RELEASE_CHECKLIST",
    required: ["npm ci", "npm run check", "v0.1.0", "Codex Security"]
  },
  {
    base: "PRODUCT",
    required: ["gcloud", "vm_only", "更多属性", "管理端口与 SSH"]
  },
  {
    base: "DESIGN",
    required: ["npm --prefix ui run check", "390px", "WARP", "更多属性"]
  }
];

function read(relativePath) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("public documentation has synchronized English and Simplified Chinese pairs", () => {
  for (const { base, required } of pairs) {
    const englishPath = `${base}.md`;
    const chinesePath = `${base}.zh-CN.md`;
    assert.doesNotThrow(() => statSync(path.join(projectRoot, englishPath)), `${englishPath} is missing`);
    assert.doesNotThrow(() => statSync(path.join(projectRoot, chinesePath)), `${chinesePath} is missing`);
    const english = read(englishPath);
    const chinese = read(chinesePath);
    assert.match(english, new RegExp(`${base}\\.zh-CN\\.md`), `${englishPath} must link to its Chinese pair`);
    assert.match(chinese, new RegExp(`${base}\\.md`), `${chinesePath} must link to its English pair`);
    for (const token of required) {
      assert.ok(english.includes(token), `${englishPath} lost required literal ${token}`);
      assert.ok(chinese.includes(token), `${chinesePath} lost required literal ${token}`);
    }
  }
});
