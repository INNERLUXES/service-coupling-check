# Changes

## 1.0.0

First release.

- Reads one or more Docker Compose files (YAML or JSON) and merges them in the order given: services by name, `depends_on` by service, `environment` by variable, `links` appended, `image` and `healthcheck` keys from the later file. `include` and `extends` are listed in a note and not followed. Never connects to anything and never fetches anything.
- Data ownership: two or more services that reach one database service by `depends_on`, `links` or an address in `environment` (`shared-database`), and the allowed case of one database server where each service names its own database (`shared-database-server`, info). A database is known by its image, by a database address that reaches it, or by `--database`.
- Startup order: a name in `depends_on` or `links` that no file defines (`unknown-dependency`), a loop (`dependency-cycle`), a chain longer than `--max-chain` (`deep-startup-chain`), `depends_on` that does not wait for a healthcheck the target has (`depends-on-not-healthy`), and a service that others depend on with no healthcheck (`no-healthcheck`).
- Coupling: one application service that most others reach (`hub-service`, with `--hub-min`), a peer reached by a fixed IP address (`hardcoded-peer-address`), and one summary line with the services table: kind, fan-in, fan-out, chain and healthcheck of every service (`summary`, info).
- A key in a shape the tool cannot read is an error (`value-invalid`), never a pass.
- Every finding has an id, a severity (error, warning, info), the file, the JSON pointer and the line, a message, a fix, and the sentence of the Compose Specification or the microservices pattern page it rests on, with the address. The value of an environment variable is never printed; only its name, and a fixed IP address.
- Every quoted sentence comes from pages that are saved in `research/sources`; a test compares `src/data.js` and the documents with the saved text.
- Reports as text, Markdown, JSON and CSV; `--fail-on` for a pipeline gate; info never fails the run; exit code `2` for a usage or input error.
- Safe input: only the files given are read, files over 10 MB are refused, at most 50 files and 5,000 services, JSON and YAML nested more than 64 deep are refused, the YAML reader refuses anchors, aliases, tags (also `!reset` and `!override`) and merge keys, the loop and chain searches walk a list instead of the call stack, address patterns are anchored and bounded, and control characters are removed from every text shown.
- Release packages come with a CycloneDX SBOM, SHA-256 checksums and a build provenance attestation.
