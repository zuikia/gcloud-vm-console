export function createTaskWorkspaceController({ state, fetchJobs, render } = {}) {
  if (!state || typeof fetchJobs !== "function" || typeof render !== "function") {
    throw new Error("state, fetchJobs, and render are required.");
  }

  function selectedJob() {
    if (state.previewFocused) return null;
    return state.jobs.find((job) => job.id === state.selectedJobId) || state.jobs[0] || null;
  }

  function rememberJob(job) {
    if (!job?.id) return;
    state.jobs = [job, ...state.jobs.filter((item) => item.id !== job.id)];
    state.selectedJobId = job.id;
    state.previewFocused = false;
    render();
  }

  function selectJob(id) {
    if (!id || !state.jobs.some((job) => job.id === id)) return;
    state.selectedJobId = id;
    state.previewFocused = false;
    render();
  }

  function focusPreview() {
    state.selectedJobId = "";
    state.previewFocused = true;
    render();
  }

  async function loadJobs() {
    const data = await fetchJobs();
    state.jobs = Array.isArray(data.jobs) ? data.jobs : [];
    state.jobStorage = data.meta && typeof data.meta === "object" ? data.meta : null;
    if (state.previewFocused) {
      state.selectedJobId = "";
    } else if (!state.jobs.some((job) => job.id === state.selectedJobId)) {
      state.selectedJobId = state.jobs[0]?.id || "";
    }
    render();
    return data;
  }

  return { loadJobs, rememberJob, selectJob, selectedJob, focusPreview };
}
