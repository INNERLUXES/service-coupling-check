// The names, lists and sentences the checks rest on. Each sentence comes from a page that is saved, with its address on
// the first line, in research/sources, and test/data.test.js compares this file with the saved text. Change a sentence
// here only after saving the new page text and updating docs/rules-and-sources.md. The checks in src/ use these
// constants and never write a Compose key or a quoted sentence of their own.

export const SOURCES = [
  { id: 'compose-services', file: 'compose-spec-services.txt', url: 'https://github.com/compose-spec/compose-spec/blob/main/05-services.md', label: 'Compose Specification, Services top-level element (depends_on, environment, extends, external_links, healthcheck, links)' },
  { id: 'compose-merge', file: 'compose-spec-merge.txt', url: 'https://github.com/compose-spec/compose-spec/blob/main/13-merge.md', label: 'Compose Specification, Merge and override' },
  { id: 'compose-include', file: 'compose-spec-include.txt', url: 'https://github.com/compose-spec/compose-spec/blob/main/14-include.md', label: 'Compose Specification, Include' },
  { id: 'db-per-service', file: 'microservices-database-per-service.txt', url: 'https://microservices.io/patterns/data/database-per-service.html', label: 'microservices.io, Pattern: Database per service' },
  { id: 'shared-db', file: 'microservices-shared-database.txt', url: 'https://microservices.io/patterns/data/shared-database.html', label: 'microservices.io, Pattern: Shared database' },
  { id: 'yaml-1.2.2', file: 'yaml-1.2.2-anchors-tags.txt', url: 'https://yaml.org/spec/1.2.2/', label: 'YAML Ain\'t Markup Language version 1.2.2, sections 3.2.2.2, 6.9.1, 6.9.2 and 7.1' }
];

export const source = (id) => SOURCES.find((s) => s.id === id);

// The keys of a Compose file that the tool reads. docs/inputs.md describes each one.
export const KEYS = {
  services: 'services',
  include: 'include',
  dependsOn: 'depends_on',
  condition: 'condition',
  links: 'links',
  externalLinks: 'external_links',
  environment: 'environment',
  envFile: 'env_file',
  healthcheck: 'healthcheck',
  test: 'test',
  disable: 'disable',
  image: 'image',
  extends: 'extends',
  containerName: 'container_name',
  hostname: 'hostname',
  networks: 'networks',
  aliases: 'aliases',
  ipv4: 'ipv4_address',
  ipv6: 'ipv6_address'
};

// The conditions of the long syntax of depends_on, as the Compose Specification lists them.
export const CONDITIONS = { started: 'service_started', healthy: 'service_healthy', completed: 'service_completed_successfully' };

// The first item of a healthcheck test that disables the check.
export const HEALTHCHECK_NONE = 'NONE';

// Images that the tool reads as a database server, by the last part of the image name (after the last "/", before the
// tag or digest), or by the last two parts. The list is the tool's own; docs/method.md says so. A service with another
// image (or a build) becomes a database when another service reaches it with a database address, or when it is named
// with --database.
export const DATABASE_IMAGES = [
  'postgres', 'postgresql', 'postgis', 'timescaledb', 'timescaledb-ha', 'mysql', 'mariadb', 'percona-server', 'mongo', 'mongodb',
  'mongodb-community-server', 'redis', 'redis-stack', 'redis-stack-server', 'valkey', 'keydb', 'cassandra', 'scylla', 'couchdb',
  'couchbase', 'neo4j', 'cockroach', 'clickhouse-server', 'influxdb', 'elasticsearch', 'opensearch', 'oracle-xe', 'oracle-free',
  'dynamodb-local', 'arangodb', 'rethinkdb', 'surrealdb', 'questdb', 'yugabyte', 'tidb', 'mssql/server', 'azure-sql-edge'
];

// Images that the tool reads as a message broker. A broker is not a database and is never reported as a hub service:
// reaching one broker is how services avoid calling each other. The list is the tool's own.
export const BROKER_IMAGES = [
  'rabbitmq', 'kafka', 'cp-kafka', 'cp-server', 'redpanda', 'nats', 'nats-streaming', 'activemq', 'activemq-artemis', 'artemis',
  'pulsar', 'zookeeper', 'cp-zookeeper', 'mosquitto', 'eclipse-mosquitto', 'emqx'
];

// URL schemes (and JDBC sub-protocols) that name a database. An address with one of them makes its host a database.
export const DATABASE_SCHEMES = [
  'postgres', 'postgresql', 'mysql', 'mariadb', 'mongodb', 'mongodb+srv', 'redis', 'rediss', 'sqlserver', 'mssql', 'cockroachdb',
  'clickhouse', 'cassandra', 'neo4j', 'neo4j+s', 'bolt', 'couchbase', 'db2', 'oracle'
];

// The end of an environment variable name that holds a bare host name (DB_HOST, CACHE_ADDR, BROKER_SERVERS).
export const HOST_NAME_ENDINGS = ['HOST', 'HOSTS', 'HOSTNAME', 'ADDR', 'ADDRESS', 'SERVER', 'SERVERS', 'ENDPOINT'];

// The endings that name a logical database next to a host variable: DB_HOST with DB_NAME, POSTGRES_HOST with POSTGRES_DB.
export const DATABASE_NAME_ENDINGS = ['NAME', 'DATABASE', 'DB'];

// Host names that are this container or the machine, never another service.
export const LOCAL_HOSTS = ['localhost', 'host.docker.internal', 'gateway.docker.internal', 'ip6-localhost'];

// Sentences quoted in the findings and the documents. Every text is on its saved page word for word
// (test/data.test.js compares them), and holds no year.
export const FACTS = {
  serviceDefinition: { source: 'compose-services', section: 'Services top-level element', text: 'A service is an abstract definition of a computing resource within an application which can be scaled or replaced independently from other components.' },
  servicesMap: { source: 'compose-services', section: 'Services top-level element', text: 'A Compose file must declare a `services` top-level element as a map whose keys are string representations of service names, and whose values are service definitions.' },
  shortSyntax: { source: 'compose-services', section: 'depends_on, short syntax', text: 'The short syntax variant only specifies service names of the dependencies.' },
  dependencyOrder: { source: 'compose-services', section: 'depends_on, short syntax', text: 'Compose creates services in dependency order.' },
  removeOrder: { source: 'compose-services', section: 'depends_on, short syntax', text: 'Compose removes services in dependency order.' },
  startedGuarantee: { source: 'compose-services', section: 'depends_on, short syntax', text: 'Compose guarantees dependency services have been started before starting a dependent service.' },
  waitHealthy: { source: 'compose-services', section: 'depends_on, long syntax', text: 'Compose waits for healthchecks to pass on dependencies marked with `service_healthy`.' },
  conditionSatisfied: { source: 'compose-services', section: 'depends_on, long syntax', text: 'Sets the condition under which dependency is considered satisfied' },
  healthcheckOverride: { source: 'compose-services', section: 'healthcheck', text: 'Your Compose file can override the values set in the Dockerfile.' },
  linkedHostname: { source: 'compose-services', section: 'links', text: 'Containers for the linked service are reachable at a hostname identical to the alias, or the service name if no alias is specified.' },
  reachByName: { source: 'compose-services', section: 'links', text: "When no specific network configuration is set, any service is able to reach any other service at that service's name on the `default` network." },
  linksNotRequired: { source: 'compose-services', section: 'links', text: 'Links are not required to enable services to communicate.' },
  extendsNotImported: { source: 'compose-services', section: 'extends, restrictions', text: 'Compose does not automatically import these referenced resources into the extended model.' },
  mergeMapping: { source: 'compose-merge', section: 'Mapping', text: 'A YAML `mapping` gets merged by adding missing entries and merging the conflicting ones.' },
  mergeSequence: { source: 'compose-merge', section: 'Sequence', text: 'A YAML `sequence` is merged by appending values from the overriding Compose file to the previous one.' },
  includeModel: { source: 'compose-include', section: 'Include', text: 'Each path listed in the `include` section is loaded as an individual Compose application model, with its own project directory, in order to resolve relative paths.' },
  looselyCoupled: { source: 'db-per-service', section: 'Forces', text: 'Services must be loosely coupled so that they can be developed, deployed and scaled independently' },
  keepPrivate: { source: 'db-per-service', section: 'Solution', text: "Keep each microservice's persistent data private to that service and accessible only via its API." },
  ownTransactions: { source: 'db-per-service', section: 'Solution', text: "A service's transactions only involve its database." },
  notDirect: { source: 'db-per-service', section: 'Solution', text: 'It cannot be accessed directly by other services.' },
  noServerEach: { source: 'db-per-service', section: 'Solution', text: 'You do not need to provision a database server for each service.' },
  logicalDatabase: { source: 'db-per-service', section: 'Example', text: 'Each service has database credentials that only grant it access its own (logical) database on a shared MySQL server.' },
  barriers: { source: 'db-per-service', section: 'Solution', text: 'It is a good idea to create barriers that enforce this modularity.' },
  sharedDefinition: { source: 'shared-db', section: 'Pattern: Shared database', text: 'Use a (single) database that is shared by multiple services.' },
  developmentCoupling: { source: 'shared-db', section: 'Drawbacks', text: 'Development time coupling - a developer working on, for example, the OrderService will need to coordinate schema changes with the developers of other services that access the same tables.' },
  runtimeCoupling: { source: 'shared-db', section: 'Drawbacks', text: 'Runtime coupling - because all services access the same database they can potentially interfere with one another.' },
  yamlAlias: { source: 'yaml-1.2.2', section: '6.9.2 Node Anchors', text: 'An alias node can then be used to indicate additional inclusions of the anchored node.' },
  yamlTag: { source: 'yaml-1.2.2', section: '6.9.1 Node Tags', text: 'The tag property identifies the type of the native data structure presented by the node.' }
};

// The page of a quoted sentence.
export const factPage = (key) => source(FACTS[key].source).url;
