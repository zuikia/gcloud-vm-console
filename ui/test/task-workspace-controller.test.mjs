import assert from "node:assert/strict";
import test from "node:test";

import { createTaskWorkspaceController } from "../public/lib/task-workspace-controller.js";

test("task controller owns selection, durable metadata, and newest-first updates", async () => {
  const state = { jobs: [], jobStorage: null, selectedJobId: "" };
  let renders = 0;
  const controller = createTaskWorkspaceController({
    state,
    fetchJobs: async () => ({
      jobs: [{ id: "job-2" }, { id: "job-1" }],
      meta: { storage: "persistent" }
    }),
    render: () => { renders += 1; }
  });

  await controller.loadJobs();
  assert.equal(controller.selectedJob().id, "job-2");
  assert.deepEqual(state.jobStorage, { storage: "persistent" });
  controller.rememberJob({ id: "job-1", status: "succeeded" });
  assert.deepEqual(state.jobs.map((job) => job.id), ["job-1", "job-2"]);
  assert.equal(controller.selectedJob().status, "succeeded");
  controller.selectJob("job-2");
  assert.equal(controller.selectedJob().id, "job-2");
  assert.equal(renders, 3);
});

test("task controller ignores empty jobs and invalid selections", () => {
  const state = { jobs: [{ id: "job-1" }], jobStorage: null, selectedJobId: "job-1" };
  let renders = 0;
  const controller = createTaskWorkspaceController({ state, fetchJobs: async () => ({}), render: () => { renders += 1; } });
  controller.rememberJob(null);
  controller.selectJob("missing");
  assert.equal(state.selectedJobId, "job-1");
  assert.equal(renders, 0);
});

test("task controller lets a new preview suppress stale job focus until a job is selected or created", async () => {
  const state = {
    jobs: [{ id: "job-old", recordId: "record-old" }],
    jobStorage: null,
    selectedJobId: "job-old",
    previewFocused: false
  };
  let renders = 0;
  const controller = createTaskWorkspaceController({
    state,
    fetchJobs: async () => ({ jobs: state.jobs }),
    render: () => { renders += 1; }
  });

  controller.focusPreview();
  assert.equal(controller.selectedJob(), null);
  assert.equal(state.previewFocused, true);
  assert.equal(state.selectedJobId, "");

  await controller.loadJobs();
  assert.equal(controller.selectedJob(), null);

  controller.selectJob("job-old");
  assert.equal(controller.selectedJob().id, "job-old");
  assert.equal(state.previewFocused, false);

  controller.focusPreview();
  controller.rememberJob({ id: "job-new", recordId: "record-new" });
  assert.equal(controller.selectedJob().id, "job-new");
  assert.equal(state.previewFocused, false);
  assert.equal(renders, 5);
});
