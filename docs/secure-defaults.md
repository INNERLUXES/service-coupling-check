# Secure defaults

The default run is the safe run. Nothing below needs a flag, and none of it can be switched off.

## How the tool behaves by default

- **No network.** The tool reads the files it is given and sends nothing anywhere. It does not resolve a host name, does not connect to a service of the files, does not pull an image and does not check for updates. An argument that looks like an address is refused. It can run in a locked-down job with no outbound access at all.
- **No commands.** The tool never runs a program, a shell, `docker`, `git` or a package manager. No name, path or value from the input is ever put on a command line.
- **No dependencies.** Node 22 or newer and nothing else, so a check does not add a supply chain of its own. There is no `node_modules` to install before it runs.
- **Strict readers.** The JSON reader accepts only JSON: no comments, no trailing commas, nesting no deeper than 64 levels, a key twice in one object refused. The YAML reader refuses anchors, aliases, tags (also `!reset` and `!override`) and merge keys with their line, and has limits on depth, nodes and the length of a scalar. A file that is not understood stops the run with exit code `2`; it is never read halfway and passed.
- **Reads only what is named.** The tool opens the files you name, and nothing that a file names: not an `include`, not the file of an `extends`, not an `env_file`, not a build context.
- **Regular files only, bounded.** Each file is opened once, its type and size are taken from the open file, and anything that is not a regular file or is over 10 MB is refused before it is read.
- **Values stay out of the report.** The value of an environment variable is never copied into a finding, a note or any format. A finding names a service by its name, a variable by its name, and a fixed address by its IP. A password in a database URL, a database name and a path are cut out of the value and dropped.
- **Clean output.** Text from the input has control characters, line separators and direction controls removed and its length capped before it reaches a report or an error message, so a hostile name or path cannot rewrite the terminal or reorder what a reader sees. Markdown cells escape pipes, backslashes, square brackets, backticks, line breaks and `<`, `>` and `&`. CSV cells are quoted as RFC 4180 says, and a cell that a spreadsheet would read as a formula gets a leading `'`.
- **No prototype tricks.** JSON and YAML are read into objects without a prototype, and services and variables are kept in maps, so a service or a key named `__proto__` or `constructor` is just data.
- **Loops are cut.** The search for loops and the longest chain walk a list, not the call stack, so a chain of thousands of services cannot overflow it.
- **A part that was not read is said.** A key that cannot be read is an error, and an `include`, an `extends`, an `env_file`, an interpolated host and a value that is too long are notes. Nothing is guessed, and a part that the tool did not read is never shown as passed.
- **The gate is on.** Without any option, an error makes the run exit with `1`.
- **Writes nothing to disk.** The report goes to the screen. Redirect it to a file or the job summary only when you need to keep it.

## Running it safely on files you do not know

1. A Compose file is data, and the tool treats it as data. Still, run it as a user with read access to the files and nothing else; it needs no account, no key, no Docker daemon and no network.
2. Read the notes and the info findings: they say what was not read, so a pass is not taken for more than it is.
3. Keep secrets out of Compose files. The tool does not print the values of variables, but the files may travel through other tools of your pipeline.

## SSDF

The repository is checked against NIST SP 800-218 (SSDF) in its own pipeline, with `ssdf-repo-check` pinned to its release commit. The evidence it looks for is in these files:

| Practice | Evidence in this repository |
| --- | --- |
| PO.1 Define security requirements | CONTRIBUTING.md, docs/secure-defaults.md |
| PO.2 Roles and responsibilities | .github/CODEOWNERS |
| PO.3 Toolchain | .github/workflows/ci.yml, codeql.yml, release.yml |
| PO.4 Criteria for security checks | CodeQL with the security-extended queries |
| PO.5 Secure environments | a `permissions:` block in every workflow, actions pinned to commits |
| PS.1 Protect the code | .gitignore for keys and `.env`, `npm run check` for committed secrets |
| PS.2 Integrity of releases | SHA-256 checksums and a build provenance attestation in release.yml |
| PS.3 Archive and provenance | a CycloneDX SBOM and the CHANGELOG with every release |
| PW.1 Design for security | docs/threat-model.md |
| PW.2 Review the design | docs/decisions |
| PW.4 Reuse secure components | no runtime dependencies, a lock file, Dependabot |
| PW.5 Secure coding | CONTRIBUTING.md, `npm run check` |
| PW.6 Build settings | `npm ci` from the lock file |
| PW.7 Code review | the pull request template and CODEOWNERS |
| PW.8 Testing | `npm test` on Linux, Windows and macOS, with hostile input tests |
| PW.9 Secure defaults | this document |
| RV.1 Find vulnerabilities | SECURITY.md, Dependabot |
| RV.2 Respond to vulnerabilities | SECURITY.md |
