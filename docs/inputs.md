# Inputs

The tool takes the paths of one or more Compose files. It reads those files and nothing else. It does not open a file that a Compose file names (`include`, `extends`, `env_file`, a build context), and never reads from standard input. A symbolic link given as an argument is followed, because the person who runs the tool named it; the file it leads to must be a regular file.

## The files

- YAML or JSON. The format is chosen from the file name (`.yaml`, `.yml`, `.json`). For any other name (`docker-compose`, `compose.override`), a file that starts with `{` is read as JSON and anything else as YAML.
- Each file over 10 MB is refused from the size of the open file, before it is read. A folder, a pipe or a device is refused.
- An argument that looks like an address (`https://...`) is refused. Nothing is downloaded.
- At most 50 files, 5,000 services, 1,000 entries in one `depends_on` or `links`, 5,000 variables in one `environment`, and 200,000 references between services.
- Each file must hold a mapping with a `services` mapping, or an `include` section. A file with neither is refused with exit code `2`.

## Several files

Give the files in the order Compose would read them, as with `docker compose -f compose.yaml -f compose.override.yaml`. The tool merges them as the Compose Specification describes for the keys it reads. The merge page says: "A YAML `mapping` gets merged by adding missing entries and merging the conflicting ones." and "A YAML `sequence` is merged by appending values from the overriding Compose file to the previous one."

| Key | How a later file changes it |
| --- | --- |
| a service | defined once more: its keys are merged into the first definition |
| `image`, `container_name`, `hostname` | the later value replaces the earlier one |
| `depends_on` | merged by service name; a later entry for the same service sets the condition. The short syntax counts as `condition: service_started` |
| `links` | appended; the same entry twice counts once |
| `environment` | merged by variable name; a later value replaces the earlier one. The list form `NAME=value` and the mapping form are read the same way |
| `healthcheck` | merged: a later `test` or `disable` replaces the earlier one; a later healthcheck with settings only (`interval`, `retries`) keeps the test of the earlier one |
| `networks` aliases and fixed addresses | added |

A note lists the services that are defined in more than one file. Reading the list form and the mapping form of `environment` the same way, and merging it by name, is the tool's own reading: the two forms set the same variables, and Compose keeps one value per variable.

The tags `!reset` and `!override`, which Compose documents for changing the merge, are refused like every other tag (see below). A file that uses them is not read.

## include and extends

`include` and `extends` are listed, not followed. The include page says: "Each path listed in the `include` section is loaded as an individual Compose application model, with its own project directory, in order to resolve relative paths." The tool reads only the files it is given, so a note lists the include paths, and a service defined in an included file is not seen. When a `depends_on` names such a service, `unknown-dependency` says that an include was not read. Give the included file as another argument to read its services (they are then merged as above, which is close to, but not the same as, what include does).

For `extends`, the services page says: "Compose does not automatically import these referenced resources into the extended model." The tool does not read the base service either: a note names every service that uses `extends`, and what it would inherit (`depends_on`, `links`, `environment`, `healthcheck`) is not seen.

## The keys of a service that are read

| Key | Read as | Used for |
| --- | --- | --- |
| `depends_on` | a list of service names (short syntax), or a mapping of service names to `condition` (`service_started`, `service_healthy`, `service_completed_successfully`), `required` and `restart` | the startup graph, `unknown-dependency`, `dependency-cycle`, `deep-startup-chain`, `depends-on-not-healthy`, `no-healthcheck`, `shared-database`, fan-in and fan-out |
| `links` | a list of `SERVICE` or `SERVICE:ALIAS` | the startup graph, the alias as a host name, `unknown-dependency`, `shared-database`, fan-in and fan-out |
| `environment` | a mapping, or a list of `NAME=value` and `NAME` | the addresses of other services (below), `shared-database`, `hardcoded-peer-address`, fan-in and fan-out |
| `healthcheck` | `test` (a text or a list; a first item `NONE` disables it) and `disable: true` | `depends-on-not-healthy`, `no-healthcheck` |
| `image` | a text | whether the service is a database or a broker |
| `container_name`, `hostname`, `networks.<name>.aliases` | texts | other names by which a service is reached |
| `networks.<name>.ipv4_address`, `ipv6_address` | texts | which service a fixed IP address belongs to |
| `extends`, `env_file`, `external_links` | present or not | notes |

Other keys are not read. A key in a shape the tool cannot read (a `depends_on` that is a text, a condition that is not one of the three, an `environment` value that is a list) is reported as `value-invalid`, and the rest of the service is still read. An empty service (`web:` with nothing under it) is read as a service with no keys.

## Addresses in environment values

The value of every variable is cut into hosts, never resolved and never printed:

- A URL with a scheme, such as `postgres://user:secret@db:5432/orders` or `http://orders:8080/api`: the host (or the hosts, for `mongodb://m1,m2/app`), the port, and the first part of the path as the database name. The user and password are skipped.
- A JDBC URL, such as `jdbc:postgresql://db/orders` or `jdbc:sqlserver://sql:1433;databaseName=orders`.
- A list of `host:port` pairs, such as `kafka:9092,kafka2:9092`, in any variable.
- A bare host name, such as `db`, only in a variable whose name ends with `_HOST`, `_HOSTS`, `_HOSTNAME`, `_ADDR`, `_ADDRESS`, `_SERVER`, `_SERVERS` or `_ENDPOINT` (or is one of these words). Next to such a variable, `<prefix>_NAME`, `<prefix>_DATABASE` or `<prefix>_DB` is read as the database name (`DB_HOST` with `DB_NAME`, `POSTGRES_HOST` with `POSTGRES_DB`).

A host is matched, without regard to case, with the link aliases of the service, then with the service names, then with `container_name`, `hostname` and network aliases. A host that matches nothing is outside the files and is not counted. `localhost`, `127.0.0.0/8`, `0.0.0.0`, `::1` and `host.docker.internal` are never another service. A host written with `${...}` is not resolved, and a note counts such values. A value longer than 4,096 characters is not read, and a note counts it.

A URL whose scheme names a database (`postgres`, `postgresql`, `mysql`, `mariadb`, `mongodb`, `mongodb+srv`, `redis`, `rediss`, `sqlserver`, `mssql`, `cockroachdb`, `clickhouse`, `cassandra`, `neo4j`, `neo4j+s`, `bolt`, `couchbase`, `db2`, `oracle`) makes the service it reaches a database, whatever its image.

## Which services are databases and brokers

A service is a database when its image is one of the list in `src/data.js` (`postgres`, `mysql`, `mariadb`, `mongo`, `redis` and others, by the last part of the image name), when another service reaches it with a database URL, or when it is named with `--database`. It is a broker when its image is one of the broker list (`rabbitmq`, `kafka`, `nats` and others). Every other service is an application. The lists are the tool's own; docs/method.md says why.

## JSON

The JSON reader accepts the JSON of RFC 8259 and nothing more: no comments, no trailing commas, no single quotes, no duplicate keys in one object. A byte order mark at the start is skipped. Nesting deeper than 64 levels, or more than 500,000 values, is refused. A key such as `__proto__` is only a name.

## The YAML that is read

The YAML reader reads what Compose files are written with, and refuses the rest with the line, never guessing.

Read:

- block mappings and block sequences, indented with spaces (a sequence may sit at the indent of its key)
- flow sequences and flow mappings (`[a, b]`, `{MODE: prod}`), nested, on one line or several
- plain, single-quoted and double-quoted scalars, on one line or several
- the block scalars `|` and `>`, with their chomping and indent indicators
- comments, and one document with or without a leading `---`

Refused, with the line:

- anchors, aliases, tags (`&`, `*`, `!`, including `!reset` and `!override`) and merge keys (`<<`). The specification describes the alias: "An alias node can then be used to indicate additional inclusions of the anchored node." A few lines of aliases can stand for a very large file, so the tool reads none. Of the tag it says: "The tag property identifies the type of the native data structure presented by the node." The tool builds no typed values. A Compose file that shares settings through `x-` fields and anchors has to be written out in full, or converted with `docker compose config` first.
- complex keys (`?`), directives (`%`), tabs in the indentation, control characters, a key given twice in one mapping, a second document
- nesting deeper than 64 levels, more than 500,000 nodes, a scalar longer than 262,144 characters

A plain scalar that looks like a number is a number, `true` and `false` are booleans, `null` and `~` are empty. `yes`, `no`, `on` and `off` are texts, as YAML 1.2 says.
