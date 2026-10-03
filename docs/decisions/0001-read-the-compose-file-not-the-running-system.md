# 1. Read the Compose file, not the running system

## Context

The tool needs to say how tightly a set of services is coupled, early enough to change it. There are richer ways to know: run the services and record the traffic, read traces from a service mesh, read the code of every service, or query the database for the users that connect to it. Each of them needs the system running, access to it, agents or instrumentation, and time, and the answer comes late. The people who need the answer often need it earlier: when the Compose file changes in a pull request, when a new service is added, when a team hands over a setup, or when an architecture is reviewed before it is split further.

A Compose file does not say everything. A call that a service makes through a registry or a value built in its code is not in it, and a database user that two services share is not in it either. A check that treated a clean file as a loosely coupled system would be wrong in the way that matters most. The reverse is true as well: a link in the file is not proof of a call on every request.

## Decision

The tool reads one or more Compose files (YAML or JSON) as data, merged as the Compose Specification describes. It reads the sentences it quotes from pages that are saved with their addresses, and a test compares the code with the saved text. It never connects to a service, never resolves a name, never pulls an image, never fetches anything and never runs a program. It reads only the files it is given, and lists `include` and `extends` instead of following them.

Every check says what it can and cannot see. A finding is worded as what the files show, and the severities and the lists of images are the tool's own and are said to be. A key that the tool cannot read is an error, not a pass. Findings carry the file, the JSON pointer and the line. They name services and variables by name, and never copy the value of a variable, apart from a fixed IP address.

The tool reads coupling only. Container hardening (limits, image tags, privileges) is the subject of `k8s-manifest-check` for Kubernetes manifests; this tool does not repeat it.

## Consequences

The check runs in a second, on Linux, macOS or Windows, with only Node, no account, no Docker daemon and no network access, and no input can make it run code or reach out to a host. The same files give the same report, so it can run every time the Compose files change and gate the merge. The cost is that it sees what the files declare, not what the services do: a call that is not in the file is missing from the report, and a link in the file may be one that is rarely used. The tool says what it left out, lists its limits in docs/limits.md, and leaves the final answer to the people who know the services.
