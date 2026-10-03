# Contributing

Every change goes through a pull request and is reviewed before it is merged. The pipeline runs the tests on Linux, Windows and macOS, the repository checks, CodeQL, and a secure development check of the repository itself.

Commit messages in this repository follow Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `ci:`, with `!` for a breaking change.

## Changing a check

1. Describe the change in docs/method.md first: what the check reports, its severity, what it can see and what it cannot, and the sentence of the page it follows. Where the tool makes its own choice (a severity, a list of database images, a limit), say so and say why.
2. Add a test with the Compose file written inline, small enough that the result can be worked out by hand, and a near miss that must not match. When the check reads a key, test it in YAML and in JSON, and in both syntaxes of the key where Compose has two.
3. Text from the input goes through `safeText` before it reaches a finding or a note, so control characters are removed. No value of an environment variable goes into a finding: a finding names a service by its name, a variable by its name, and a fixed address by its IP.
4. A finding id, once released, keeps its meaning: pipelines and other tools read it from the JSON and CSV reports.
5. A thing the tool cannot see is reported as a note or a finding, never passed.

## Changing the quoted sentences or the lists

The sentences in `src/data.js` come from the pages saved in `research/sources`: the Compose Specification pages on services, merging and include, the microservices.io pages on the database per service and the shared database patterns, and the YAML specification. When a page changes, save the new text in `research/sources` (the address on the first line, plain ASCII, no date), change `src/data.js` to match, and update docs/rules-and-sources.md. `test/data.test.js` compares every quoted sentence with the saved text, so changing one without the other fails. The code in `src` writes no Compose key of its own; it takes them from `src/data.js`.

The lists of database images, broker images, database URL schemes and host variable names are the tool's own. Add to them with a test that shows a real Compose file that needs the entry, and a near miss that must not match.

Never add a rule or a quoted sentence from memory or from a blog post. A new rule needs the official page, opened and saved, and the words of the page that it rests on.

## Changing the readers

1. For the JSON and YAML readers and the address reader, add a test for every form you add and one that must be refused. Keep refusing YAML anchors, aliases, tags and merge keys, and JSON that is not JSON.
2. Keep the size, depth and count limits, and keep a limit on the length of a value before a pattern runs on it. A pattern must be anchored, with bounded repeats and no nested repetition; add a test with a long near miss.
3. Paths are opened with `path.resolve`, never `path.join`, so an absolute path works on every system. Paths shown in a report are relative, with forward slashes. Do not assume that a backslash is a separator on Linux or macOS. A test that depends on the operating system (a path with a backslash, a link, a name with a control character, a device file) is guarded with `process.platform`, and every other test builds its paths with `resolve()` from names with forward slashes.

## Rules for the code

- No runtime dependencies. Node 22 or newer and nothing else.
- The tool reads the files it is given and writes only to the screen. It opens no network connection and runs no program.
- Source files stay ASCII; write any other character in a pattern as a Unicode escape, or build it from its code point.
- Never commit a real secret, even as a fixture. `npm run check` fails on anything that looks like a credential.
- The README and the documents carry no dates or years. Version numbers (YAML 1.2.2, Node 22) are fine.

## Before you open the pull request

```
npm test
npm run check
npm run example
```
