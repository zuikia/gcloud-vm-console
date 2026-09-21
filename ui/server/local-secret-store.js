import { randomUUID } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import path from "node:path";

const FILE_NAME = "ssh-auth.json";

function validTimestamp(value) {
  const text = String(value || "");
  if (!text || Number.isNaN(new Date(text).getTime())) throw new Error("Local SSH secret is unavailable or invalid.");
  return text;
}

function validatePassword(value) {
  const password = String(value ?? "");
  if (password.length < 8 || password.length > 128 || /[\0\r\n:]/.test(password)) {
    throw new Error("SSH password must be 8-128 characters and cannot contain colon, NUL, or line breaks.");
  }
  return password;
}

function normalizeStored(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || input.schemaVersion !== 1) {
    throw new Error("Local SSH secret is unavailable or invalid.");
  }
  const password = validatePassword(input.password);
  const versionId = String(input.versionId || "");
  if (!/^[a-f0-9-]{20,64}$/i.test(versionId)) throw new Error("Local SSH secret is unavailable or invalid.");
  return {
    schemaVersion: 1,
    password,
    versionId,
    updatedAt: validTimestamp(input.updatedAt)
  };
}

export function createLocalSecretStore({
  rootDir,
  now = () => new Date().toISOString(),
  fileSystem = nodeFs,
  randomId = randomUUID
} = {}) {
  if (!rootDir) throw new Error("rootDir is required.");
  const root = path.resolve(rootDir);
  const filePath = path.join(root, FILE_NAME);
  const quarantineRoot = path.join(root, "quarantine");
  let temporaryCounter = 0;
  let quarantineCounter = 0;

  async function ensureDirectory(directory) {
    await fileSystem.mkdir(directory, { recursive: true, mode: 0o700 });
    await fileSystem.chmod(directory, 0o700);
  }

  async function quarantine() {
    try {
      await ensureDirectory(quarantineRoot);
      quarantineCounter += 1;
      const destination = path.join(quarantineRoot, `${Date.now()}-${quarantineCounter}-${FILE_NAME}`);
      await fileSystem.rename(filePath, destination);
      await fileSystem.chmod(destination, 0o600);
    } catch (error) {
      if (error?.code !== "ENOENT") throw new Error("Local SSH secret is unavailable or invalid.");
    }
  }

  async function readRaw() {
    await ensureDirectory(root);
    try {
      return normalizeStored(JSON.parse(await fileSystem.readFile(filePath, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      await quarantine();
      throw new Error("Local SSH secret is unavailable or invalid.");
    }
  }

  async function saveSshPassword(value) {
    const password = validatePassword(value);
    const stored = normalizeStored({
      schemaVersion: 1,
      password,
      versionId: String(randomId()),
      updatedAt: now()
    });
    await ensureDirectory(root);
    temporaryCounter += 1;
    const temporaryPath = path.join(root, `.${FILE_NAME}-${process.pid}-${Date.now()}-${temporaryCounter}.tmp`);
    try {
      await fileSystem.writeFile(temporaryPath, `${JSON.stringify(stored)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx"
      });
      await fileSystem.chmod(temporaryPath, 0o600);
      await fileSystem.rename(temporaryPath, filePath);
      await fileSystem.chmod(filePath, 0o600);
    } catch (error) {
      await fileSystem.rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
    return { configured: true, versionId: stored.versionId, updatedAt: stored.updatedAt };
  }

  async function readSshPassword() {
    const stored = await readRaw();
    if (!stored) throw new Error("Local SSH secret is unavailable or invalid.");
    return { password: stored.password, versionId: stored.versionId, updatedAt: stored.updatedAt };
  }

  async function publicStatus() {
    try {
      const stored = await readRaw();
      return stored
        ? { configured: true, versionId: stored.versionId, updatedAt: stored.updatedAt }
        : { configured: false, versionId: "", updatedAt: "" };
    } catch {
      return { configured: false, versionId: "", updatedAt: "" };
    }
  }

  return { publicStatus, readSshPassword, saveSshPassword };
}
