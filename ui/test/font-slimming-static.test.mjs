import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = readFileSync(new URL("../package-lock.json", import.meta.url), "utf8");

test("font loading keeps one IBM Plex asset and uses platform CJK fallbacks", () => {
  assert.doesNotMatch(styles, /@import\s+url\(/);
  assert.match(styles, /ibm-plex-sans-latin-wght-normal\.woff2/);
  assert.match(styles, /--font-sans:[^;]*PingFang SC[^;]*Hiragino Sans GB[^;]*Microsoft YaHei[^;]*system-ui/);
  assert.match(styles, /--font-heading:[^;]*Songti SC[^;]*STSong[^;]*SimSun[^;]*ui-serif/);
  assert.doesNotMatch(styles, /Noto Sans SC|Noto Serif SC/);
});

test("package dependencies do not bundle CJK font families", () => {
  assert.deepEqual(Object.keys(packageJson.dependencies || {}), ["@fontsource-variable/ibm-plex-sans"]);
  assert.doesNotMatch(packageLock, /@fontsource-variable\/noto-(?:sans|serif)-sc/);
});

test("main canvas avoids fixed radial paint effects", () => {
  const body = styles.match(/body \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.doesNotMatch(body, /radial-gradient|background-attachment:\s*fixed/);
});
