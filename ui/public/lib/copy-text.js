export async function copyText(text, env = {}) {
  const value = String(text || "");
  const nav = env.navigator || globalThis.navigator;
  const doc = env.document || globalThis.document;

  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(value);
      return { ok: true, method: "clipboard" };
    } catch {
      // Try the local textarea fallback below.
    }
  }

  let node = null;
  try {
    if (!doc?.body || typeof doc.createElement !== "function" || typeof doc.execCommand !== "function") {
      throw new Error("copy fallback unavailable");
    }
    node = doc.createElement("textarea");
    node.value = value;
    node.setAttribute("readonly", "");
    node.style.position = "fixed";
    node.style.left = "-9999px";
    node.style.top = "0";
    doc.body.appendChild(node);
    node.select();
    const ok = doc.execCommand("copy");
    doc.body.removeChild(node);
    node = null;
    if (!ok) throw new Error("copy failed");
    return { ok: true, method: "fallback" };
  } catch (error) {
    if (node && doc?.body?.removeChild) {
      try {
        doc.body.removeChild(node);
      } catch {
        // Ignore cleanup errors; the copy result is already failed.
      }
    }
    return { ok: false, method: "failed", error: error.message || "copy failed" };
  }
}
