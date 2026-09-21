function resourceRecordId(resource) {
  return String(resource?.record?.id || "");
}

export function jobBelongsToResource(job, resource) {
  const recordId = resourceRecordId(resource);
  return Boolean(job?.id && job?.recordId && recordId && String(job.recordId) === recordId);
}

export function findResourceForJob(job, resources = []) {
  if (!job?.recordId) return null;
  return (Array.isArray(resources) ? resources : []).find((resource) => jobBelongsToResource(job, resource)) || null;
}

export function toDiagnosticFocus({
  route = "",
  selectedResource = null,
  selectedJob = null,
  resources = []
} = {}) {
  const jobResource = findResourceForJob(selectedJob, resources);
  if (route === "tasks" && selectedJob?.id) {
    return {
      source: "task",
      resource: jobResource || null,
      job: selectedJob,
      jobResourceMatched: Boolean(jobResource)
    };
  }
  if (selectedResource) {
    return {
      source: "resource",
      resource: selectedResource,
      job: jobBelongsToResource(selectedJob, selectedResource) ? selectedJob : null,
      jobResourceMatched: jobBelongsToResource(selectedJob, selectedResource)
    };
  }
  return {
    source: selectedJob?.id ? "task" : "empty",
    resource: jobResource || null,
    job: selectedJob?.id ? selectedJob : null,
    jobResourceMatched: Boolean(jobResource)
  };
}

export function diagnosticVmFromResource(resource) {
  if (!resource) return null;
  return {
    name: resource.identity?.name || "",
    zone: resource.identity?.zone || "",
    externalIp: resource.cloud?.network?.externalIp || resource.record?.observed?.network?.externalIp || "",
    verification: resource.record?.verification || null
  };
}

export function diagnosticEvidenceForFocus(focus = {}) {
  const resource = focus.resource || null;
  const job = focus.job || null;
  return {
    selectedJob: job,
    nodeResult: resource?.record?.nodeResult || job?.result?.nodeResult || null,
    verification: resource?.record?.verification || job?.result?.verification || null,
    recognition: job?.result?.recognition || null
  };
}
