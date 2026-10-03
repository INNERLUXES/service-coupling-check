# service-coupling-check

Reads one or more Docker Compose files (YAML or JSON) and reports how tightly the services are coupled. You give it the files. It merges them as Compose does, and reads every service with its `depends_on`, `links`, `environment`, `healthcheck` and image. It reports services that share one database, a loop in `depends_on` or `links`, a startup chain that is too long, a `depends_on` that does not wait for a healthcheck, a service that others depend on with no healthcheck, one service that most others reach, a peer reached by a fixed IP address, and a name that no file defines. Every finding names the file, the JSON pointer and the line, the severity, a sentence on how to fix it, and the sentence of the Compose Specification or of the microservices pattern page that it rests on, with its address.

A Compose file is often the only place where all the services of a system are written down together. It shows which service waits for which, which database each one reaches, and how they find each other. Two services that both write to one database, a gateway that waits for a chain of four services, a payment service that calls another by a fixed address: all of these are visible in the file, long before anyone draws the architecture. This tool reads them in a second, so the check can run every time the file changes.

- Every finding has an id, a severity (error, warning or info), the file, the JSON pointer and the line, a plain message, a fix, and the quoted sentence of the page it rests on, with the address of the saved page.
- What a Compose file cannot show is said, not guessed. A file shows declared links, not the calls the services really make at run time; [docs/limits.md](docs/limits.md) lists what is out of reach.
- Every quoted sentence comes from the official pages, which are saved in [research/sources](research/sources); a test compares [src/data.js](src/data.js) and the documents with the saved text.
- The value of an environment variable is never printed. A finding names the variable, the service it reaches, and for a fixed address, the IP.
- Reports as text, Markdown, JSON and CSV, with an exit code for a pipeline gate. Info findings never fail the run.
- Plain JavaScript, no dependencies; the same files always give the same report. The YAML reader is strict: anchors, aliases, tags and merge keys are refused with their line.

```
npm test
```

```
tests 103
pass 99
fail 0
skipped 4
```

These are the summary lines that `npm test` prints at the end. The four skipped tests are the ones that need a system other than Windows: a symbolic link test, a device file, a file name with a control character, and a file name with a backslash. They are guarded with `process.platform`. On Linux and macOS only the test for Windows paths is skipped, and 102 of the 103 run.

## Quick start

Requires Node 22 or newer. There is nothing to install.

```
git clone https://github.com/INNERLUXES/service-coupling-check.git
cd service-coupling-check
node bin/service-coupling-check.js examples/shop.compose.yaml
```

Or without a clone, in the folder of your Compose files:

```
npx --yes github:INNERLUXES/service-coupling-check compose.yaml
```

`examples/` holds a made-up shop. `examples/shop.compose.yaml` has a gateway, orders, payments, users and a catalog, and one Postgres database, wrong on purpose: four services use one database, users and catalog wait for each other, the gateway waits for a chain of four services, payments depends on a service that does not exist and calls users by a fixed IP address, and most services call users. `examples/shop-fixed.compose.yaml` is the same shop repaired, and `examples/shop-fixed.override.yaml` adds local settings on top of it, as a second file. Together they pass at the strictest level. `examples/shop.compose.json` is a smaller shop in JSON.

## Usage

```
node bin/service-coupling-check.js examples/shop.compose.yaml --fail-on warning
```

```
service-coupling-check: examples/shop.compose.yaml
compose: 1 file, 6 services (5 application, 1 database, 0 broker), 13 references (8 depends_on, 1 links, 9 environment), chain limit 3, hub minimum 3
areas:
  Compose model     pass   no finding
  Data ownership    fail   shared-database x1
  Startup order     fail   unknown-dependency x1, dependency-cycle x1, deep-startup-chain x1, depends-on-not-healthy x5, no-healthcheck x2
  Coupling          warn   hub-service x1, hardcoded-peer-address x1, summary x1
services:
  service   kind         fan-in  fan-out  chain  healthcheck
  gateway   application       0        4      4  no
  orders    application       1        3      3  yes
  payments  application       2        2      2  no
  users     application       4        2      1  yes
  catalog   application       2        2      0  no
  postgres  database          4        0      0  yes
findings: 3 error, 10 warning, 1 info

Data ownership (1 finding)

  ERROR    shared-database  examples/shop.compose.yaml #/services/postgres  line 64
           The services "orders" (depends_on, DATABASE_URL), "payments" (PAYMENTS_DB_HOST), "users" (depends_on, DATABASE_URL) and "catalog" (SPRING_DATASOURCE_URL) all reach the database service "postgres", and at least two of them name the same database on it. A change to one table can then break another service, and one service's load or locks can slow down the others.
           basis: "Keep each microservice's persistent data private to that service and accessible only via its API." (Solution, https://microservices.io/patterns/data/database-per-service.html)
           basis: "Development time coupling - a developer working on, for example, the OrderService will need to coordinate schema changes with the developers of other services that access the same tables." (Drawbacks, https://microservices.io/patterns/data/shared-database.html)
           fix: Give each service its own database (a database server per service, or its own database or schema on "postgres" with credentials that reach only that one), and let the other services ask the owner through its API.

Startup order (10 findings)

  ERROR    unknown-dependency  examples/shop.compose.yaml #/services/payments/depends_on/fraud-check  line 37
           The service "payments" depends on "fraud-check" in depends_on, and no file defines a service of that name, so Compose cannot start "payments".
           basis: "The short syntax variant only specifies service names of the dependencies." (depends_on, short syntax, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           basis: "Compose guarantees dependency services have been started before starting a dependent service." (depends_on, short syntax, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           fix: Define the service "fraud-check", correct the name, or remove the entry.

  ERROR    dependency-cycle  examples/shop.compose.yaml #/services/users/links/0  line 50
           The services "users" and "catalog" depend on each other in a loop through depends_on and links, so there is no order in which Compose can create them, or remove them.
           basis: "Compose creates services in dependency order." (depends_on, short syntax, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           basis: "Compose removes services in dependency order." (depends_on, short syntax, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           fix: Remove the link that is not needed at startup. If the services truly need each other, they are one unit: merge them, or let one find the other at run time and retry instead of waiting for it at startup.

  WARNING  deep-startup-chain  examples/shop.compose.yaml #/services/gateway/depends_on/0  line 11
           The service "gateway" starts only after a chain of 4 services: gateway -> orders -> payments -> users -> postgres. The limit is 3. Each step waits for the one below it, so a slow or failing service at the end holds up every service above it.
           basis: "Compose guarantees dependency services have been started before starting a dependent service." (depends_on, short syntax, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           basis: "Services must be loosely coupled so that they can be developed, deployed and scaled independently" (Forces, https://microservices.io/patterns/data/database-per-service.html)
           fix: Remove the depends_on entries that are not needed at startup, and let a service retry a peer at run time instead of waiting for it. Raise the limit with --max-chain only if the chain is wanted.

  WARNING  depends-on-not-healthy  examples/shop.compose.yaml #/services/gateway/depends_on/0  line 11
           The service "gateway" depends on "orders" with the short syntax, so Compose starts it as soon as the container of "orders" has started, not when it is healthy, although "orders" has a healthcheck.
           basis: "Compose guarantees dependency services have been started before starting a dependent service." (depends_on, short syntax, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           basis: "Compose waits for healthchecks to pass on dependencies marked with `service_healthy`." (depends_on, long syntax, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           fix: Write the long syntax with "condition: service_healthy" for "orders".

  WARNING  depends-on-not-healthy  examples/shop.compose.yaml #/services/gateway/depends_on/2  line 13
           The service "gateway" depends on "users" with the short syntax, so Compose starts it as soon as the container of "users" has started, not when it is healthy, although "users" has a healthcheck.
           basis: "Compose guarantees dependency services have been started before starting a dependent service." (depends_on, short syntax, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           basis: "Compose waits for healthchecks to pass on dependencies marked with `service_healthy`." (depends_on, long syntax, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           fix: Write the long syntax with "condition: service_healthy" for "users".

  WARNING  depends-on-not-healthy  examples/shop.compose.yaml #/services/orders/depends_on/1  line 24
           The service "orders" depends on "postgres" with the short syntax, so Compose starts it as soon as the container of "postgres" has started, not when it is healthy, although "postgres" has a healthcheck.
           basis: "Compose guarantees dependency services have been started before starting a dependent service." (depends_on, short syntax, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           basis: "Compose waits for healthchecks to pass on dependencies marked with `service_healthy`." (depends_on, long syntax, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           fix: Write the long syntax with "condition: service_healthy" for "postgres".

  WARNING  depends-on-not-healthy  examples/shop.compose.yaml #/services/payments/depends_on/users  line 35
           The service "payments" depends on "users" with the condition service_started, so Compose starts it as soon as the container of "users" has started, not when it is healthy, although "users" has a healthcheck.
           basis: "Compose guarantees dependency services have been started before starting a dependent service." (depends_on, short syntax, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           basis: "Compose waits for healthchecks to pass on dependencies marked with `service_healthy`." (depends_on, long syntax, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           fix: Write the long syntax with "condition: service_healthy" for "users".

  WARNING  depends-on-not-healthy  examples/shop.compose.yaml #/services/catalog/depends_on/0  line 60
           The service "catalog" depends on "users" with the short syntax, so Compose starts it as soon as the container of "users" has started, not when it is healthy, although "users" has a healthcheck.
           basis: "Compose guarantees dependency services have been started before starting a dependent service." (depends_on, short syntax, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           basis: "Compose waits for healthchecks to pass on dependencies marked with `service_healthy`." (depends_on, long syntax, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           fix: Write the long syntax with "condition: service_healthy" for "users".

  WARNING  no-healthcheck  examples/shop.compose.yaml #/services/payments  line 32
           The service "orders" depends on "payments", which declares no healthcheck in the file, so nothing tells it when "payments" is ready to answer. The image may define a healthcheck that the file does not show.
           basis: "Compose waits for healthchecks to pass on dependencies marked with `service_healthy`." (depends_on, long syntax, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           basis: "Your Compose file can override the values set in the Dockerfile." (healthcheck, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           fix: Add a healthcheck to "payments" that tests what its dependents need (for example that it answers on its port), and make them wait with "condition: service_healthy".

  WARNING  no-healthcheck  examples/shop.compose.yaml #/services/catalog  line 57
           The service "gateway" depends on "catalog", which declares no healthcheck in the file, so nothing tells it when "catalog" is ready to answer. The image may define a healthcheck that the file does not show.
           basis: "Compose waits for healthchecks to pass on dependencies marked with `service_healthy`." (depends_on, long syntax, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           basis: "Your Compose file can override the values set in the Dockerfile." (healthcheck, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           fix: Add a healthcheck to "catalog" that tests what its dependents need (for example that it answers on its port), and make them wait with "condition: service_healthy".

Coupling (3 findings)

  WARNING  hub-service  examples/shop.compose.yaml #/services/users  line 44
           4 of the 4 other application services reach "users": "gateway", "orders", "payments" and "catalog". A change to its API, a slow answer or an outage of "users" reaches most of the application at once, and it cannot be changed or replaced on its own.
           basis: "A service is an abstract definition of a computing resource within an application which can be scaled or replaced independently from other components." (Services top-level element, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           basis: "Services must be loosely coupled so that they can be developed, deployed and scaled independently" (Forces, https://microservices.io/patterns/data/database-per-service.html)
           fix: Check whether every service needs "users" directly. Callers can get its data from events they keep a copy of, or through the gateway; split "users" if it does more than one job.

  WARNING  hardcoded-peer-address  examples/shop.compose.yaml #/services/payments/environment/USERS_ADDR  line 42
           The variable USERS_ADDR of the service "payments" reaches 203.0.113.17 by IP address. An address written into the file breaks when the network or the other service moves, and hides the link between the services from anyone who reads the file.
           basis: "When no specific network configuration is set, any service is able to reach any other service at that service's name on the `default` network." (links, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           basis: "Containers for the linked service are reachable at a hostname identical to the alias, or the service name if no alias is specified." (links, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           fix: Use the name of the service (or a network alias) as the host, and let the Compose network resolve it.

  INFO     summary  examples/shop.compose.yaml #/services  line 5
           6 services (5 application, 1 database, 0 broker) with 13 references between them (8 by depends_on, 1 by links, 9 by environment). The highest fan-in is "users" (4) and the highest fan-out is "gateway" (4).
           basis: "A service is an abstract definition of a computing resource within an application which can be scaled or replaced independently from other components." (Services top-level element, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           fix: Nothing to fix; this line and the services table show the shape of the application.

GATE: FAIL - 3 errors, 10 warnings
```

The exit code is `1`: errors fail the run by default. The ten warnings do not, unless you run with `--fail-on warning`, as here. The `info` finding never fails a run. The services table shows the kind of every service, how many services reach it (fan-in), how many it reaches (fan-out), the steps of its longest startup chain, and whether it has a healthcheck.

The repaired shop passes, also with `--fail-on warning`:

```
node bin/service-coupling-check.js examples/shop-fixed.compose.yaml examples/shop-fixed.override.yaml --fail-on warning
```

```
service-coupling-check: examples/shop-fixed.compose.yaml, examples/shop-fixed.override.yaml
compose: 2 files, 7 services (5 application, 2 database, 0 broker), 9 references (9 depends_on, 0 links, 9 environment), chain limit 3, hub minimum 3
areas:
  Compose model     pass   no finding
  Data ownership    info   shared-database-server x1
  Startup order     pass   no finding
  Coupling          info   summary x1
services:
  service     kind         fan-in  fan-out  chain  healthcheck
  gateway     application       0        4      3  no
  orders      application       1        2      2  yes
  payments    application       2        1      1  yes
  users       application       1        1      1  yes
  catalog     application       1        1      1  yes
  postgres    database          3        0      0  yes
  catalog-db  database          1        0      0  yes
findings: 0 error, 0 warning, 2 info

Data ownership (1 finding)

  INFO     shared-database-server  examples/shop-fixed.compose.yaml #/services/postgres  line 75
           The services "orders" (depends_on, DATABASE_URL), "payments" (depends_on, PAYMENTS_DB_HOST) and "users" (depends_on, DATABASE_URL) reach the database server "postgres", and each names a database of its own on it. One server for several services is allowed when each service can reach only its own database. The file cannot show the credentials or the grants that keep them apart.
           basis: "You do not need to provision a database server for each service." (Solution, https://microservices.io/patterns/data/database-per-service.html)
           basis: "Each service has database credentials that only grant it access its own (logical) database on a shared MySQL server." (Example, https://microservices.io/patterns/data/database-per-service.html)
           fix: Check that each service has its own credentials and that they grant access to its own database on "postgres" only.

Coupling (1 finding)

  INFO     summary  examples/shop-fixed.compose.yaml #/services  line 7
           7 services (5 application, 2 database, 0 broker) with 9 references between them (9 by depends_on, 0 by links, 9 by environment). The highest fan-in is "postgres" (3) and the highest fan-out is "gateway" (4).
           basis: "A service is an abstract definition of a computing resource within an application which can be scaled or replaced independently from other components." (Services top-level element, https://github.com/compose-spec/compose-spec/blob/main/05-services.md)
           fix: Nothing to fix; this line and the services table show the shape of the application.

note: The services "orders" and "payments" are defined in more than one file and were merged in the order of the arguments (docs/inputs.md)

GATE: PASS (--fail-on warning)
```

Orders, payments and users still use one Postgres server, but each names a database of its own on it, which the database per service page allows: "You do not need to provision a database server for each service." That is info, because the file cannot show the credentials that keep the databases apart. Passing means that none of the checks found anything in the files. It does not mean that the services are loosely coupled at run time; [docs/limits.md](docs/limits.md) lists what a Compose file cannot show.

```
service-coupling-check <compose-file>... [options]
```

```
--format <name>          text, markdown, json or csv (default: text)
--fail-on <level>        exit with 1 when a finding is at this level or above: error or warning
                         (default: error); info never fails the run
--max-chain <n>          the longest chain of depends_on and links allowed (default: 3)
--hub-min <n>            the fewest application services that must reach one service before it is a hub
                         (default: 3)
--database <service>     read this service as a database; may be given more than once
--help                   show the usage
--version                show the version
```

Give several files in the order Compose reads them, as with `docker compose -f compose.yaml -f compose.override.yaml`. Paths in the report are relative to the folder you run the command in, with forward slashes on every system; a file outside it is shown with its absolute path.

## What is read

[docs/inputs.md](docs/inputs.md) has the whole list, the merge rules and the YAML that is read.

| Key | What the tool takes from it |
| --- | --- |
| `depends_on` | which services a service waits for, in the short or the long syntax, and the condition |
| `links` | which services a service links to, and the alias |
| `environment` | the hosts in the values: URLs (`postgres://db/orders`, `http://users:8080`), JDBC URLs, `host:port` lists, and bare names in `*_HOST`-like variables |
| `healthcheck` | whether the service has a test, settings only, or a disabled check |
| `image` | whether the service is a database (`postgres`, `mysql`, `mongo`, `redis` and others) or a broker (`rabbitmq`, `kafka`, `nats` and others) |
| `container_name`, `hostname`, network aliases | other names by which the service is reached |
| `include`, `extends`, `env_file` | listed in a note; the files they name are not opened |

A service is also a database when another service reaches it with a database URL, or when you name it with `--database`.

## The checks

| Id | Severity | What it reports |
| --- | --- | --- |
| `value-invalid` | error | A key of a service is in a shape the tool cannot read |
| `unknown-dependency` | error | `depends_on` or `links` names a service that no file defines |
| `dependency-cycle` | error | Services wait for each other in a loop through `depends_on` and `links` |
| `shared-database` | error | Two or more services reach one database service, and the files do not show that each uses its own database on it |
| `deep-startup-chain` | warning | A chain of `depends_on` and `links` is longer than `--max-chain` (3) |
| `depends-on-not-healthy` | warning | `depends_on` waits only for the start of a service that has a healthcheck |
| `no-healthcheck` | warning | Other services depend on a service that declares no healthcheck |
| `hub-service` | warning | Most of the other application services, and at least `--hub-min` (3), reach one application service |
| `hardcoded-peer-address` | warning | An environment value reaches another service by a fixed IP address instead of its name |
| `shared-database-server` | info | Several services reach one database server, and each names a database of its own on it |
| `summary` | info | The services by kind, the references between them, and the highest fan-in and fan-out |

[docs/method.md](docs/method.md) gives each check, its exact rule, what it can see and what it cannot. [docs/rules-and-sources.md](docs/rules-and-sources.md) lists every quoted sentence with the saved page it comes from.

## Where the facts come from

| Fact | Source |
| --- | --- |
| What a service is, `depends_on` and its conditions, healthchecks, links and reaching a service by its name | Compose Specification, https://github.com/compose-spec/compose-spec/blob/main/05-services.md |
| How several Compose files are merged | Compose Specification, https://github.com/compose-spec/compose-spec/blob/main/13-merge.md |
| What `include` does | Compose Specification, https://github.com/compose-spec/compose-spec/blob/main/14-include.md |
| Database per service, and one server with a database for each service | microservices.io, https://microservices.io/patterns/data/database-per-service.html |
| The shared database and its drawbacks | microservices.io, https://microservices.io/patterns/data/shared-database.html |
| YAML anchors, aliases and tags | https://yaml.org/spec/1.2.2/ |

## Formats

- `text`: for a terminal: the files, the counts, the areas with their result, the services table, then the findings grouped by area, each with its rule id, file, pointer, line, message, quotation and fix.
- `markdown`: the same for a pull request comment or the job summary. Pipes, square brackets, backticks, line breaks and angle brackets from the input are escaped, so a service name cannot break a table or make a link.
- `json`: the whole report: the counts, the areas, the services table, every finding with id, severity, area, file, where, line, subject, message, fix, basis and source, the notes and the gate.
- `csv`: one row per finding, quoted as RFC 4180 says. A cell that starts with `=`, `+`, `-` or `@` gets a leading `'`, so a spreadsheet does not run it as a formula.

To put the report in the job summary of a GitHub Actions run:

```yaml
permissions:
  contents: read
steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
    with:
      node-version: 22
  - name: Service coupling report
    run: npx --yes github:INNERLUXES/service-coupling-check compose.yaml --format markdown >> "$GITHUB_STEP_SUMMARY"
  - name: Service coupling gate
    run: npx --yes github:INNERLUXES/service-coupling-check compose.yaml --fail-on warning
```

It needs no secrets, no Docker daemon and no build; a Linux runner is enough. Start with the default gate (errors only), and move to `--fail-on warning` when the first report is clean.

## Exit codes

`0` no finding at the `--fail-on` level, `1` at least one such finding (by default: an error), `2` a usage or input error (a missing file, a file that is not JSON or the YAML the tool reads, a YAML anchor, alias or tag, a file with no `services`, a file over the size limit, an unknown option).

## Limits

The tool reads what the files declare, not what the services do. A Compose file cannot show runtime calls between services, only declared links and addresses: a call through a service registry, a value built in the code or an address in an `env_file` is not seen, and a database user that two services share is not seen either. A finding is a review item, and a clean report is not a loosely coupled system. [docs/limits.md](docs/limits.md) lists these, with the size limits.

## Related

The tool reads the coupling between services. It does not read how each container is hardened: resource limits, image tags, privileged containers and the like are the subject of `k8s-manifest-check` in the same organization, for Kubernetes manifests. This tool reads Compose files, and only the keys that link one service to another.

## Background

- How systems are split into services, and how the coupling between them is reviewed, with checks like this one in the pipeline: [microservices architecture consulting](https://innerluxes.dev/software-development/microservices-consulting).

## License

MIT
