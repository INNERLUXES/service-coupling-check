# Security

## Reporting a problem

Write to info@innerluxes.dev with the subject line "service-coupling-check security", or use private vulnerability reporting on this repository. Please do not open a public issue for a vulnerability.

Include a small made-up Compose file that shows the problem, what you expected and what happened. Use made-up names, and no real host names, internal addresses, credentials or customer data.

## Scope

In scope:

- an input that makes the tool open a network connection, open a file other than the ones it was given (such as a file named in `include`, `extends` or `env_file`), or run a program
- an input that makes the tool print the value of an environment variable, which it is documented not to print (only the name, and a fixed IP address, are printed)
- a file that makes a reader accept something its documented format does not allow, such as a YAML anchor, an alias, a tag or a merge key
- an input that makes the tool hang, take very long, or use unbounded memory or stack, such as deep nesting, very many services or values, a very long value, a quote that is never closed, a long chain or a loop of dependencies, or a path that is not a regular file
- text from a path, a service name or a variable name that breaks a Markdown table, injects a formula into a CSV report, or rewrites the terminal through control or direction characters
- a key or a service name such as `__proto__` that changes how objects behave inside the tool
- a finding that docs/method.md says is reported, for an input the tool accepts, that the report leaves out, or a key that the tool did not read and shows as passed
- a sentence in src/data.js that differs from the saved page in research/sources

Out of scope: how the services really call each other at run time (docs/limits.md lists what a Compose file cannot show), the specification and the pattern pages the tool follows, and how your pipeline stores the reports.

Read [docs/threat-model.md](docs/threat-model.md) for the rest.
