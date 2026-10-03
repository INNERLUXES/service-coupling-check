# Method

The tool reads one or more Compose files as data, merges them, and runs the checks below. Every check says what it reports, why it has the severity it has, what it can see and what it cannot, and the sentence of the Compose Specification or of the microservices pattern page that it rests on. The pages are saved in [research/sources](../research/sources), and a test compares every quoted sentence with the saved text. Where the tool makes a choice that no page states (a severity, a list of database images, a limit), the text says so.

Nothing is fetched at run time. A finding names a service by its name, an environment variable by its name, and a fixed address by its IP. The rest of the value of a variable (a password, a path, a database name) is never copied into a finding.

## What is read

The services of every file, with `depends_on`, `links`, `environment`, `healthcheck`, `image`, `container_name`, `hostname` and the aliases and fixed addresses of `networks`, merged as [inputs.md](inputs.md) says. From these the tool builds the references between services:

- **depends_on** and **links** are startup references. The services page says of links: "Links also express implicit dependency between services in the same way as [depends_on](#depends_on), so they determine the order of service startup."
- **environment** references are the addresses in environment values that name another service. They do not change the startup order, but they show which service calls which. The page says: "When no specific network configuration is set, any service is able to reach any other service at that service's name on the `default` network." and "Links are not required to enable services to communicate."

Fan-in is the number of other services that reach a service by any of the three; fan-out is the number of other services it reaches. A reference from a service to itself is not counted.

## The kinds of service

Every service is a database, a broker or an application:

- **database**: its image is on the list of database images in `src/data.js` (by the last part of the name, after the last `/` and before the tag, or by the last two parts, as in `mssql/server`), another service reaches it with a database URL (`postgres://`, `jdbc:mysql://`, `redis://` and the others of [inputs.md](inputs.md)), or it is named with `--database`.
- **broker**: its image is on the list of broker images (`rabbitmq`, `kafka`, `nats` and others).
- **application**: every other service, including every service built from source (`build:`) that is not reached with a database URL.

The lists are the tool's own, not a page's. They hold common official and widely used images; a database with another image is found by its address, or named with `--database`.

## Compose model

### `value-invalid` (error)

A key of a service in a shape the tool cannot read: a definition that is not a mapping, a `depends_on` that is neither a list nor a mapping, a condition that is not one of `service_started`, `service_healthy` and `service_completed_successfully`, an entry of `links` that is not a text, an `environment` that is neither a mapping nor a list or a variable whose value is a list or a mapping, a `healthcheck` that is not a mapping, an `image`, `container_name` or `hostname` that is not a text. The specification describes what a file holds: "A Compose file must declare a `services` top-level element as a map whose keys are string representations of service names, and whose values are service definitions." The rest of the service is read, but the checks that need the key cannot run on it, so it is an error: a key the tool cannot read must not pass quietly.

A file that is not YAML or JSON, uses an anchor, an alias, a tag or a merge key, or has no `services` mapping and no `include`, is not read at all and stops the run with exit code `2`.

## Data ownership

### `shared-database` (error)

Two or more services that are not databases reach the same database service, by `depends_on`, by `links` or by an address in `environment`, and the files do not show that each one uses a database of its own on it. The database per service page says: "Keep each microservice's persistent data private to that service and accessible only via its API." and "It cannot be accessed directly by other services." The shared database page names the cost: "Development time coupling - a developer working on, for example, the OrderService will need to coordinate schema changes with the developers of other services that access the same tables." and "Runtime coupling - because all services access the same database they can potentially interfere with one another."

The finding is placed at the database service and lists every service that reaches it, with how (`depends_on`, `links`, or the names of the variables). It says whether two of them name the same database, or whether the files do not name one for some of them.

What it cannot see: a service that reaches the database only through a variable in an `env_file`, or a host built with `${...}`. A one-off job in the same file (a migration or a seed job) that reaches the database is counted as a service like any other; if it belongs to one service, it is still a second client of the database, and the report says so.

### `shared-database-server` (info)

Two or more services reach one database server, and each of them names a database of its own on it, and no two name the same one. The page allows this: "You do not need to provision a database server for each service." Its example is the same shape: "Each service has database credentials that only grant it access its own (logical) database on a shared MySQL server." It is info, because the files show the separate databases but not the credentials or the grants that keep them apart. The page asks for those: "It is a good idea to create barriers that enforce this modularity."

A database name is read from the path of a database URL (`postgres://db/orders`, `jdbc:mysql://db:3306/orders`, `redis://cache/2`), from `databaseName=` in a JDBC URL, or from the variable next to a host variable (`DB_HOST` with `DB_NAME`, `POSTGRES_HOST` with `POSTGRES_DB`). A service that reaches the database only by `depends_on` or `links`, or by a URL with no path, names no database, and the finding is then `shared-database`.

## Startup order

The startup graph is made of the `depends_on` and `links` references between services that the files define.

### `unknown-dependency` (error)

An entry of `depends_on` or `links` that names a service no file defines. The page says: "The short syntax variant only specifies service names of the dependencies." and "Compose guarantees dependency services have been started before starting a dependent service." A service that is not defined cannot be started, so it is an error. When a file has an `include` section, the message says that the included files were not read; give them as more arguments to read their services.

### `dependency-cycle` (error)

Services that depend on each other in a loop through `depends_on` and `links`, found as the strongly connected components of the startup graph; a service that names itself is a loop too. Each loop is reported once, at the first of its services, with up to ten names. The page says: "Compose creates services in dependency order." and "Compose removes services in dependency order." A loop has no such order. An address in `environment` both ways is not a loop: it does not decide the startup order.

### `deep-startup-chain` (warning)

A chain of `depends_on` and `links` with more steps than the limit (`--max-chain`, 3 by default). The chain is reported once, at the service at its top (a service that no other service waits for), with the services of the longest chain below it. The page says: "Compose guarantees dependency services have been started before starting a dependent service." So each step waits for the one below it, and a slow or failing service at the bottom holds up everything above it. The database per service page lists among its forces: "Services must be loosely coupled so that they can be developed, deployed and scaled independently" The steps inside a loop are not counted (the loop is reported by `dependency-cycle`), so a loop never makes an endless chain. The limit of 3 is the tool's own: a gateway, a service, a service it calls and a database is three steps.

### `depends-on-not-healthy` (warning)

An entry of `depends_on` in the short syntax, or with `condition: service_started`, on a service that has a healthcheck in the file (with a test, or with settings only, whose test comes from the image). The page says: "Compose guarantees dependency services have been started before starting a dependent service." and, of the long syntax: "Compose waits for healthchecks to pass on dependencies marked with `service_healthy`." With the short syntax the dependent starts when the container of its dependency has started, which may be long before it answers. An entry with `service_completed_successfully` (a one-off job) is not reported.

### `no-healthcheck` (warning)

A service that other services depend on (with any condition but `service_completed_successfully`), and that declares no healthcheck in the file, or disables it (`disable: true`, or a test of `NONE`). It is reported once per service, with the names of its dependents. The page says: "Compose waits for healthchecks to pass on dependencies marked with `service_healthy`." With no healthcheck nothing can tell the dependents when the service is ready. When a dependent waits with `service_healthy`, the message says that Compose can meet it only if the image defines a healthcheck.

What it cannot see: the healthcheck of the image. The page says: "Your Compose file can override the values set in the Dockerfile." The tool reads the file, not the image, so a service whose image defines a healthcheck is still reported; the message says so. It is a warning for that reason.

## Coupling

### `hub-service` (warning)

An application service that most of the other application services reach: at least `--hub-min` of them (3 by default), and more than half. Databases and brokers are never hubs: a database shared by several services is reported by `shared-database`, and reaching one broker is how services avoid calling each other. The services page describes a service as one that "can be scaled or replaced independently from other components": "A service is an abstract definition of a computing resource within an application which can be scaled or replaced independently from other components." A service that most others call cannot be changed or replaced on its own, and its outage reaches most of the application at once. It is a warning, because a hub can be intended (an identity service, a configuration service); the thresholds are the tool's own.

### `hardcoded-peer-address` (warning)

An environment value that reaches a host by a fixed IP address (IPv4 or IPv6), other than a local address (`127.0.0.0/8`, `0.0.0.0`, `::1`). It is reported once per variable. When the address is the fixed `ipv4_address` or `ipv6_address` of a service in the files, the message names that service. The page says: "When no specific network configuration is set, any service is able to reach any other service at that service's name on the `default` network." and "Containers for the linked service are reachable at a hostname identical to the alias, or the service name if no alias is specified." An address written into the file breaks when the network changes, and hides which service is meant. An IP that belongs to no service in the files may be a host outside them; it is still reported, because the file cannot tell.

### `summary` (info)

One line: the number of services by kind, the number of references between them by `depends_on`, `links` and `environment` (a pair of services counts once for each way it is linked), and the services with the highest fan-in and fan-out. The report also holds a table with every service: its kind, fan-in, fan-out, the steps of its longest startup chain and whether it has a healthcheck (`yes`, `partial` for settings only, `disabled` or `no`). It never fails a run.

## Severities and the gate

An error is something the files show to be wrong (a name that is not defined, a loop, a database that several services use), or a key the tool cannot read. A warning is a coupling that most reviewers would ask about. Info is an allowed shape that still needs a look, or the summary. With the default `--fail-on error`, only errors fail the run; `--fail-on warning` fails on warnings too; info never fails. The severities are the tool's own, and the pages do not state them.

When one check finds more than 200 things, the first 200 are listed, in a fixed order, and the rest is counted (the gate uses the full count) and named in a note.
