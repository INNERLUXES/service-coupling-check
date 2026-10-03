# Limits

## What a Compose file cannot show

- **Runtime calls between services.** A Compose file shows declared links: `depends_on`, `links`, and the addresses written in `environment`. It does not show which service really calls which, how often, or over what. A service that finds a peer through a service registry, a configuration server, a file mounted into the container, a command line argument or a value built in its code is not seen, and the file passes without that link. To see the real calls, read traces, service mesh metrics or the code.
- **What a reference means.** A `depends_on` entry, an address in a variable and a link all count as a reference. The tool cannot tell a call on every request from a call once a day, a synchronous call from a message sent through a queue, or a variable that is set and never used.
- **Shared data that is not a database service.** Two services that mount the same volume, write to the same bucket, or reach a database outside the files share data too. The tool looks only at services in the files that it reads as databases.
- **The grants inside a database.** `shared-database-server` sees that each service names its own database on one server. It cannot see whether the credentials of one service also reach the database of another, or whether two services use one schema under two names.
- **The image.** A healthcheck in the Dockerfile of the image, a default environment variable of the image, or a database server inside an application image is not seen. `no-healthcheck` says so in its message.
- **Values from outside the file.** `${...}` is not resolved, and `env_file`, `.env` and the environment of the shell are not read. A note counts the values that were not read.
- **Other files.** `include` and `extends` are listed and not followed; profiles are not applied, so a service that only runs with a profile is checked like any other.
- **The deployment.** Compose is often a local or test setup. The same services may be deployed with other links, other databases and other healthchecks elsewhere; this tool reads only the Compose files.

## What the tool does not check

- Whether the services are well designed. It reads files and connects to nothing.
- Container settings that are not about coupling: resource limits, image tags, privileges, users, read-only file systems. `k8s-manifest-check` reads those for Kubernetes manifests.
- Ports, volumes, secrets, configs and networks other than aliases and fixed addresses.
- The text of the values. Only the hosts and the database names are cut out of them, and neither is printed except a fixed IP address.

## Size and depth

- Each file over 10 MB is refused, from the size of the open file. At most 50 files.
- At most 5,000 services, 1,000 entries in one `depends_on` or `links`, 5,000 variables in one `environment`, and 200,000 references between services.
- JSON nested deeper than 64 levels, or with more than 500,000 values, is refused. YAML nested deeper than 64 levels, with more than 500,000 nodes or a scalar over 262,144 characters, is refused.
- An environment value longer than 4,096 characters, or with more than 50 hosts, is not read for addresses.
- A check that finds more than 200 things lists the first 200 in a fixed order, counts the rest in the totals and the gate, and says so in a note.
- Text from the files shown in a report is cut to a fixed length: 80 characters for a name in a message, 400 for a place, 200 for a subject, 900 for a message and 500 for a fix.

Every limit is reported, as a finding, a note or a refusal with exit code `2`, so a cut is never silent.
