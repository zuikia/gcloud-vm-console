import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { computeRuntimeRevision } from "../scripts/runtime-revision.mjs";

test("runtime revision changes with active server or public sources and ignores tests", async (t) => {
  const uiRoot = await mkdtemp(path.join(tmpdir(), "gcp-runtime-revision-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(uiRoot, { recursive: true, force: true });
  });

  await Promise.all([
    mkdir(path.join(uiRoot, "server"), { recursive: true }),
    mkdir(path.join(uiRoot, "public", "lib"), { recursive: true }),
    mkdir(path.join(uiRoot, "scripts"), { recursive: true }),
    mkdir(path.join(uiRoot, "test"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(path.join(uiRoot, "server.js"), "export const server = 1;\n"),
    writeFile(path.join(uiRoot, "server", "router.js"), "export const router = 1;\n"),
    writeFile(path.join(uiRoot, "public", "index.html"), "<main>one</main>\n"),
    writeFile(path.join(uiRoot, "public", "styles.css"), "main { color: white; }\n"),
    writeFile(path.join(uiRoot, "public", "lib", "view.js"), "export const view = 1;\n"),
    writeFile(path.join(uiRoot, "scripts", "runtime-revision.mjs"), "export const helper = 1;\n"),
    writeFile(path.join(uiRoot, "package.json"), "{\"type\":\"module\"}\n"),
    writeFile(path.join(uiRoot, "test", "ignored.test.mjs"), "first\n")
  ]);

  const initial = computeRuntimeRevision({ uiRoot });
  assert.match(initial, /^[a-f0-9]{64}$/);

  await writeFile(path.join(uiRoot, "test", "ignored.test.mjs"), "second\n");
  assert.equal(computeRuntimeRevision({ uiRoot }), initial);

  await writeFile(path.join(uiRoot, "public", "index.html"), "<main>two</main>\n");
  assert.notEqual(computeRuntimeRevision({ uiRoot }), initial);
});
