function rejectPolicy() {
  throw new Error("Read-only command policy rejected this gcloud command.");
}

function classify(command) {
  if (!Array.isArray(command) || command.length < 3 || command[0] !== "compute") rejectPolicy();
  const group = command[1];
  const action = command[2];
  if (group === "instances") {
    if (action === "list" && command.length === 3) return { mode: "read", category: "instances.list" };
    if (action === "describe" && command.length === 4 && !command[3].startsWith("-")) return { mode: "read", category: "instances.describe" };
    if (action === "get-guest-attributes" && command.length >= 4 && !command[3].startsWith("-")
      && command.slice(4).every((part) => part.startsWith("--query-path="))) {
      return { mode: "read", category: "instances.guest-attributes" };
    }
    rejectPolicy();
  }
  if (group === "firewall-rules") {
    if (action === "list" && command.length === 3) return { mode: "read", category: "firewall.list" };
    if (action === "describe" && command.length === 4 && !command[3].startsWith("-")) return { mode: "read", category: "firewall.describe" };
    rejectPolicy();
  }
  rejectPolicy();
}

export function createReadOnlyCommandGuard(runner, { onCommand = () => {} } = {}) {
  if (!runner?.run || !runner?.runJson) throw new Error("runner with run() and runJson() is required.");
  function approved(command) {
    const entry = classify(command);
    onCommand({ ...entry });
    return entry;
  }
  return {
    async run(command, options) {
      approved(command);
      return runner.run(command, options);
    },
    async runJson(command, options) {
      approved(command);
      return runner.runJson(command, options);
    }
  };
}
