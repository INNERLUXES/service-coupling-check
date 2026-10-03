# Rules and sources

Every sentence that the tool quotes comes from a page that is saved in [research/sources](../research/sources), with its address on the first line. `src/data.js` holds them, and `test/data.test.js` compares each one with the saved text. Nothing was added from memory. Change a sentence only after saving the new page text and updating this file.

## The saved pages

| File | Address | What it is used for |
| --- | --- | --- |
| `compose-spec-services.txt` | https://github.com/compose-spec/compose-spec/blob/main/05-services.md | what a service is, `depends_on` and its conditions, `environment`, `extends`, `external_links`, `healthcheck`, `links` and how services reach each other by name |
| `compose-spec-merge.txt` | https://github.com/compose-spec/compose-spec/blob/main/13-merge.md | how several Compose files are merged |
| `compose-spec-include.txt` | https://github.com/compose-spec/compose-spec/blob/main/14-include.md | what `include` does, which the tool lists and does not follow |
| `microservices-database-per-service.txt` | https://microservices.io/patterns/data/database-per-service.html | the database per service pattern, and the allowed shared server with a database for each service |
| `microservices-shared-database.txt` | https://microservices.io/patterns/data/shared-database.html | the shared database pattern and its drawbacks |
| `yaml-1.2.2-anchors-tags.txt` | https://yaml.org/spec/1.2.2/ | anchors, aliases and tags, which the YAML reader refuses |

The Compose Specification pages are saved from the Markdown source of the specification: the opening of the services page and the sections `depends_on`, `environment`, `extends` (up to its restrictions), `external_links`, `healthcheck` and `links`; the merge page whole; the include page up to its long syntax. The version badges are left out. The microservices.io pages are saved as the text of the pattern, from its title to its list of related patterns, with the navigation, the side bar and the footer left out. The YAML page is saved as the four sections on anchors, aliases and tags. Typographic dashes and quotes are written as plain ASCII.

## The sentences that the findings quote

Each sentence is on its saved page word for word. A key used by "docs" is quoted in the documents and in no finding.

| Key | Used by | Sentence | Page and section |
| --- | --- | --- | --- |
| `serviceDefinition` | `hub-service`, `summary` | "A service is an abstract definition of a computing resource within an application which can be scaled or replaced independently from other components." | `compose-spec-services.txt`, Services top-level element |
| `servicesMap` | `value-invalid` | "A Compose file must declare a `services` top-level element as a map whose keys are string representations of service names, and whose values are service definitions." | `compose-spec-services.txt`, Services top-level element |
| `shortSyntax` | `unknown-dependency` | "The short syntax variant only specifies service names of the dependencies." | `compose-spec-services.txt`, depends_on, short syntax |
| `dependencyOrder` | `dependency-cycle` | "Compose creates services in dependency order." | `compose-spec-services.txt`, depends_on, short syntax |
| `removeOrder` | `dependency-cycle` | "Compose removes services in dependency order." | `compose-spec-services.txt`, depends_on, short syntax |
| `startedGuarantee` | `unknown-dependency`, `deep-startup-chain`, `depends-on-not-healthy` | "Compose guarantees dependency services have been started before starting a dependent service." | `compose-spec-services.txt`, depends_on, short syntax |
| `waitHealthy` | `depends-on-not-healthy`, `no-healthcheck` | "Compose waits for healthchecks to pass on dependencies marked with `service_healthy`." | `compose-spec-services.txt`, depends_on, long syntax |
| `conditionSatisfied` | docs | "Sets the condition under which dependency is considered satisfied" | `compose-spec-services.txt`, depends_on, long syntax |
| `healthcheckOverride` | `no-healthcheck` | "Your Compose file can override the values set in the Dockerfile." | `compose-spec-services.txt`, healthcheck |
| `linkedHostname` | `hardcoded-peer-address` | "Containers for the linked service are reachable at a hostname identical to the alias, or the service name if no alias is specified." | `compose-spec-services.txt`, links |
| `reachByName` | `hardcoded-peer-address` | "When no specific network configuration is set, any service is able to reach any other service at that service's name on the `default` network." | `compose-spec-services.txt`, links |
| `linksNotRequired` | docs | "Links are not required to enable services to communicate." | `compose-spec-services.txt`, links |
| `extendsNotImported` | docs | "Compose does not automatically import these referenced resources into the extended model." | `compose-spec-services.txt`, extends, restrictions |
| `mergeMapping` | docs | "A YAML `mapping` gets merged by adding missing entries and merging the conflicting ones." | `compose-spec-merge.txt`, Mapping |
| `mergeSequence` | docs | "A YAML `sequence` is merged by appending values from the overriding Compose file to the previous one." | `compose-spec-merge.txt`, Sequence |
| `includeModel` | docs | "Each path listed in the `include` section is loaded as an individual Compose application model, with its own project directory, in order to resolve relative paths." | `compose-spec-include.txt`, Include |
| `looselyCoupled` | `deep-startup-chain`, `hub-service` | "Services must be loosely coupled so that they can be developed, deployed and scaled independently" | `microservices-database-per-service.txt`, Forces |
| `keepPrivate` | `shared-database` | "Keep each microservice's persistent data private to that service and accessible only via its API." | `microservices-database-per-service.txt`, Solution |
| `ownTransactions` | docs | "A service's transactions only involve its database." | `microservices-database-per-service.txt`, Solution |
| `notDirect` | docs | "It cannot be accessed directly by other services." | `microservices-database-per-service.txt`, Solution |
| `noServerEach` | `shared-database-server` | "You do not need to provision a database server for each service." | `microservices-database-per-service.txt`, Solution |
| `logicalDatabase` | `shared-database-server` | "Each service has database credentials that only grant it access its own (logical) database on a shared MySQL server." | `microservices-database-per-service.txt`, Example |
| `barriers` | docs | "It is a good idea to create barriers that enforce this modularity." | `microservices-database-per-service.txt`, Solution |
| `sharedDefinition` | docs | "Use a (single) database that is shared by multiple services." | `microservices-shared-database.txt`, Pattern: Shared database |
| `developmentCoupling` | `shared-database` | "Development time coupling - a developer working on, for example, the OrderService will need to coordinate schema changes with the developers of other services that access the same tables." | `microservices-shared-database.txt`, Drawbacks |
| `runtimeCoupling` | docs | "Runtime coupling - because all services access the same database they can potentially interfere with one another." | `microservices-shared-database.txt`, Drawbacks |
| `yamlAlias` | docs | "An alias node can then be used to indicate additional inclusions of the anchored node." | `yaml-1.2.2-anchors-tags.txt`, 6.9.2 Node Anchors |
| `yamlTag` | docs | "The tag property identifies the type of the native data structure presented by the node." | `yaml-1.2.2-anchors-tags.txt`, 6.9.1 Node Tags |

## The findings

| Id | Severity | Area | Sentences | Where the rule is written |
| --- | --- | --- | --- | --- |
| `value-invalid` | error | Compose model | `servicesMap` | [method.md](method.md#value-invalid-error) |
| `unknown-dependency` | error | Startup order | `shortSyntax`, `startedGuarantee` | [method.md](method.md#unknown-dependency-error) |
| `dependency-cycle` | error | Startup order | `dependencyOrder`, `removeOrder` | [method.md](method.md#dependency-cycle-error) |
| `shared-database` | error | Data ownership | `keepPrivate`, `developmentCoupling` | [method.md](method.md#shared-database-error) |
| `deep-startup-chain` | warning | Startup order | `startedGuarantee`, `looselyCoupled` | [method.md](method.md#deep-startup-chain-warning) |
| `depends-on-not-healthy` | warning | Startup order | `startedGuarantee`, `waitHealthy` | [method.md](method.md#depends-on-not-healthy-warning) |
| `no-healthcheck` | warning | Startup order | `waitHealthy`, `healthcheckOverride` | [method.md](method.md#no-healthcheck-warning) |
| `hub-service` | warning | Coupling | `serviceDefinition`, `looselyCoupled` | [method.md](method.md#hub-service-warning) |
| `hardcoded-peer-address` | warning | Coupling | `reachByName`, `linkedHostname` | [method.md](method.md#hardcoded-peer-address-warning) |
| `shared-database-server` | info | Data ownership | `noServerEach`, `logicalDatabase` | [method.md](method.md#shared-database-server-info) |
| `summary` | info | Coupling | `serviceDefinition` | [method.md](method.md#summary-info) |

## What the tool decided itself

These are not stated by a page, and the documents say so where they apply:

- the severity of every finding
- the lists of database images, broker images, database URL schemes and host variable names
- that a service reached with a database URL is a database, and that a broker is never a database or a hub
- that a reference by `environment` counts for fan-in, fan-out and `shared-database`, but not for the startup order
- that a database name is read from a URL path, a JDBC `databaseName`, or the `_NAME`, `_DATABASE` or `_DB` variable next to a host variable
- the default limits: a chain of 3 steps, and a hub reached by at least 3 and by more than half of the other application services
- that `environment` is merged by variable name across files, and that its list and mapping forms are read the same way
- that `include` and `extends` are listed and not followed
- the limit of 200 listed findings per check, and the size and depth limits
