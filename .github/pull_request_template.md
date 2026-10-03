## What changes

<!-- One or two sentences. -->

## Checks

- [ ] `npm test`, `npm run check` and `npm run example` pass, and the files under `examples/output` are the ones `npm run example` wrote
- [ ] A change to a check or a reader is described in docs/method.md or docs/inputs.md, says what the check can and cannot see, and has a test with the Compose file written inline and a near miss that must not match
- [ ] A change to a quoted sentence or a Compose key follows the official pages: the new page text is saved in research/sources, `src/data.js` and docs/rules-and-sources.md match it, and nothing was added from memory
- [ ] Text from the input goes through `safeText`, and no value of an environment variable is copied into a finding (only its name, and a fixed IP address)
- [ ] The tool still fetches nothing, opens no connection and runs no program
- [ ] A thing the tool cannot see is reported as a note or a finding, never as passed or as proven
- [ ] A test that depends on the operating system (a path, a backslash, a link, a file name, a line end) is guarded with `process.platform` or builds its path with `resolve()` from forward-slash names
- [ ] No real secret in fixtures or examples, and no calendar year in the README or the documents
- [ ] The commit messages of this pull request follow Conventional Commits
