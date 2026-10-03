# Threat model

## What the tool touches

- It reads the files named on the command line. Nothing else on the disk is opened.
- It does not follow a path written inside a file: not `include`, not the file of `extends`, not `env_file`, not a build context. A symbolic link given as an argument is followed, because the person who runs the tool named it; the target must be a regular file.
- It writes only to the screen (standard output and standard error).
- It opens no network connection and runs no program: not a shell, not `docker`, not a DNS lookup.

## What the input may hold

A Compose file is often edited by many people, checked in a pipeline that runs on pull requests, and copied from examples on the internet or from a vendor. The tool treats each file as possibly hostile. It can be huge, hold very many services or values, very long values, or a quote that is never closed. It can be very deeply nested, in blocks or in brackets. It can use anchors and aliases that expand to far more than the file holds, or tags that ask a loader to build typed values. A service name can be `__proto__` or `constructor`, or hold control and direction characters. A name can start with `=` so that a spreadsheet runs it. The references can form a chain of thousands of services, or a loop. An environment variable can hold a password, a token or an internal address that should not be copied into a job log.

## What could go wrong, and what stops it

| Risk | Control |
| --- | --- |
| A huge file, very many services or values, or deep nesting exhaust memory or time | Each file over 10 MB is refused from the size of the open file before it is read; at most 50 files and 5,000 services; JSON and YAML deeper than 64 levels, or with more than 500,000 values or nodes, are refused; a YAML scalar is limited to 262,144 characters. The readers recurse only as deep as their limits |
| A quote or a bracket that is never closed makes a reader scan the file again and again | The YAML reader looks at each line a bounded number of times and stops at the limit of a scalar or at the end of the file with the line |
| A YAML alias bomb expands a small file into a huge structure | Anchors, aliases, tags and merge keys are refused with their line; nothing is ever expanded |
| A long chain or a loop of references overflows the stack or runs for ever | The loop search (Tarjan's strongly connected components) and the longest chain walk a list, not the call stack, and visit each service once; the links inside a loop are left out of the chain, so no chain is endless; at most 1,000 entries in one `depends_on` or `links` and 200,000 references |
| Thousands of findings of one kind make the report huge | A check lists its first 200 findings in a fixed order, counts the rest in the totals and the gate, and says so in a note |
| A crafted value makes an address pattern run for a very long time | A value over 4,096 characters is not read; values are cut with `indexOf` and `split`, and the patterns are anchored, with bounded repeats and no nested repetition. Tests run long near misses and check the time |
| A service or a key named `__proto__` or `constructor` changes how objects behave | JSON and YAML are read into objects without a prototype; services, variables and references are kept in maps. A test checks that no prototype changes |
| A name or a path rewrites the terminal through escape sequences, or reorders text with direction characters | The YAML reader refuses control characters; control characters (C0 and C1), line and paragraph separators and Unicode direction controls are replaced by a space before any text reaches a report or an error message, and the length is capped |
| A name breaks the Markdown table in the job summary, makes a link, or hides text as an HTML tag | Pipes, backslashes, square brackets, backticks, line breaks, `<`, `>` and `&` are escaped in every table cell |
| A CSV report runs a formula when opened in a spreadsheet | Cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return get a leading `'`; every cell is quoted as RFC 4180 says |
| A password, a token or a database name in an environment value is copied into a report, a job log or the job summary | Only the variable name, the service it reaches and a fixed IP address are copied. Tests put marker values in variables and check that they appear in no report |
| A key that cannot be read is skipped, and a check passes without having run | A key that cannot be read is an error (`value-invalid`); an include, an extends, an env_file, an interpolated host and a value that is too long are notes. Nothing is guessed |
| A file names another file, so the tool reads more than it was given | `include`, `extends` and `env_file` are listed in notes and never opened |
| The argument names a URL, so the tool becomes a fetcher | Arguments that look like addresses are refused; reading from standard input is refused |
| A pipe or a device in place of a file makes the tool hang | The type is looked at before the file is opened and again on the open file, and anything that is not a regular file is refused |

## Out of scope

How the services behave at run time: the real calls, the real data, the images. The correctness of the specification and the pattern pages the tool follows. [limits.md](limits.md) lists what a Compose file cannot show.
