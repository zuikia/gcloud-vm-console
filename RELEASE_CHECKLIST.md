# Public release checklist

[简体中文](RELEASE_CHECKLIST.zh-CN.md) · English

This checklist is for the maintainer before each public GitHub release.

## Local gate

- [x] Runtime data and browser artifacts excluded from the staged release
- [x] Real account, project, key-path, IP, and live acceptance values removed
- [x] License, security policy, contribution guide, and dependency notices added
- [x] CI workflow added
- [x] `npm ci` reports no high-severity audit findings
- [x] `npm run check` passes all tests
- [x] Browser layout audit passes on a machine with browser automation enabled
- [x] Browser performance audit reports four startup waves and no writes
- [x] Public user-facing documentation has synchronized English/Chinese pairs

## Before pushing

- [x] Review the staged file list and confirm no private docs or private screenshots are included
- [x] Confirm MIT is the intended license and all included source can be released
- [x] Choose the final GitHub repository owner and name
- [x] Confirm the repository description and visibility are public
- [ ] Enable private vulnerability reporting or publish a private security contact
- [ ] Add repository topics such as `google-cloud`, `gcloud`, `compute-engine`,
      `vm-management`, and `infrastructure-safety`
- [ ] Create the next release only after the public README renders correctly

## Before applying to Codex for Open Source

- [x] Track the superseded `v0.1.0` baseline in the changelog
- [ ] Publish `v0.2.0` and verify the CI badge/build
- [x] Add a screenshot or short demo using mock data
- [ ] Record any early issues, pull requests, or users without inventing usage numbers
- [ ] Prepare the application using the primary-maintainer role
- [ ] Request API credits only for this repository's maintainer workflows
- [ ] Request Codex Security only after confirming the repository contains no
      unauthorized infrastructure targets
