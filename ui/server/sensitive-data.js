function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Keep panel metadata useful without allowing installer credentials to cross
 * the record/job/API boundary. The installer output is still consumed in
 * memory to determine whether credentials were generated, but the secret
 * itself is never returned or persisted.
 */
export function sanitizeNodeResult(input) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) return input;
  const result = clone(input);
  if (!result.panel || typeof result.panel !== "object" || Array.isArray(result.panel)) return result;

  const panel = { ...result.panel };
  const credentialsAvailable = Boolean(panel.credentialsAvailable || panel.password || panel.apiToken || panel.token);
  delete panel.password;
  delete panel.apiToken;
  delete panel.token;
  if (credentialsAvailable) panel.credentialsAvailable = true;
  else delete panel.credentialsAvailable;
  result.panel = panel;
  return result;
}

export function sanitizeJobResult(input) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) return input;
  const result = clone(input);
  if (result.nodeResult) result.nodeResult = sanitizeNodeResult(result.nodeResult);
  if (result.result?.nodeResult) result.result.nodeResult = sanitizeNodeResult(result.result.nodeResult);
  return result;
}
