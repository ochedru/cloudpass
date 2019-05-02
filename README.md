# Cloudpass

[![Build Status](https://travis-ci.org/dhatim/cloudpass.svg?branch=master)](https://travis-ci.org/dhatim/cloudpass)
[![GitHub version](https://badge.fury.io/gh/dhatim%2Fcloudpass.svg)](https://badge.fury.io/gh/dhatim%2Fcloudpass)
[![Coverage Status](https://coveralls.io/repos/github/dhatim/cloudpass/badge.svg?branch=master)](https://coveralls.io/github/dhatim/cloudpass?branch=master)
[![Greenkeeper badge](https://badges.greenkeeper.io/dhatim/cloudpass.svg)](https://greenkeeper.io/)

Cloudpass is an implementation of Stormpath Identity Management written in Node.js.

It takes care of all the tedious user management tasks for you: account verification and password reset email worfklows, role management, multi-tenancy, SSO...

Persistence of data is done either through PostgreSQL, MySQL, MariaDB, SQLite or MSSQL.

## Installation

### Debian based distributions

Cloudpass can be installed on Debian and Ubuntu based linux distributions from a package hosted on Bintray.
Note that this package depends on PostgreSQL, as it is the default DBMS.

- Cloupdass needs Node.js 6.x to run, so you will need to add node debian repository to your source list if you have not done so already. You can find instructions [here](https://nodejs.org/en/download/package-manager/#debian-and-ubuntu-based-linux-distributions).

- Add Dhatim Bintray's debian repository in sources.list:
  ```bash
  echo "deb http://dl.bintray.com/dhatim/deb stable main" | sudo tee -a /etc/apt/sources.list
  ```

- If it is the first repository from Bintray that you add, you will also need to add Bintray's public key to apt:
  ```bash
  sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys 379CE192D401AB61
  ```

- Now all you need to do is install the cloudpass package:
  ```bash
  sudo apt-get update && sudo apt-get install cloudpass
  ```
  It can take a few minutes. Don't worry, that's just `npm install` doing its job. Subsequent updates will be much faster!

Cloudpass is now installed as a systemd service with no additional configuration needed!

To stop it: `sudo systemctl stop cloudpass.service`, or alternatively `sudo service cloudpass stop` (the `start` and `restart` commands are of course also available).

You can see the logs with `sudo journaltcl -u cloudpass`.

### Docker

An [image is available on docker hub](https://hub.docker.com/r/dhatim/cloudpass). It uses SQLite by default.

### Other systems

- Install Node.js (version 6). You can find installation instructions for your system [here](nodejs.org/en/download/package-manager).
- Clone the repository: `git clone https://github.com/dhatim/cloudpass.git`, or simply [download the zip](https://github.com/dhatim/cloudpass/archive/master.zip) and extract it somewhere.
- Run `npm install --production`.
- Configure the persistence (c.f. below).
- Start the server with `npm start`.

## Configuration

If you installed the debian package, the configuration files are located in `/etc/cloudpass`. Else they are in the `config` folder of your installation directory.

The default configuration is in `default.yaml`. You should not modify this file, but either:
- create a `local.yaml` file and override the values you need.
- set an environment variable for each configuration value changed. The name of these environment variables can be found in the `custom-environment-variables.yaml` file.
- use a single `NODE_CONFIG` environment variable containing all your configuration changes in JSON format:

   ```bash
   export NODE_CONFIG='{"persistence":{"database":"cloudpass","username":"postgres","password":"postgres","options": {"host":"customerdb.prod","port":5432}}}'
   npm start
   ```
   Don't forget to escape the quotes if you pass this variable to `docker run`:
   ```bash
   export NODE_CONFIG='{\"persistence\":{\"database\":\"cloudpass\",\"username\":\"postgres\",\"password\":\"postgres\",\"options\":{\"host\":\"customerdb.prod\",\"port\":5432}}}'
   docker run -e "NODE_CONFIG=$NODE_CONFIG" -P dhatim/cloudpass
   ```

There are four configuration sections: *server*, *persistence*, *email* and *logging*.

### Server

- `rootUrl`: In RESTful webservices (which Cloudpass is), resources are identified unique URIs. For instance, the representation of a tenant with id `foo` will look something like this:
  ```json
  {
    "href": "https://cloudpass.example.com/v1/tenants/foo",
    "applications":{
      "href": "https://cloudpass.example.com/v1/tenants/foo/applications"
    }
  }
  ```
  In this example, the `rootUrl` would be `https://cloudpass.example.com`. Cloudpass has no way of figuring this out on its own because he cannot know if it is being accessed directly or from behind a proxy.
  If `rootUrl` is left null, all hrefs will be relatives (e.g `/tenants/foo`). This should be fine in most cases. However:
    - this is not necessarily well supported by Stormpath clients. In particular, we had issues with `delete` operations on the Java client. If you are interested, there is a [fork](https://github.com/dhatim/stormpath-sdk-java) fixing this issue.
    - if you mount Cloudpass after one or more path segments (e.g. `htpp://www.example.com/my/cloudpass/instance/`) and use [Sauthc1 authentication](https://github.com/stormpath/stormpath-sdk-spec/blob/master/specifications/algorithms/sauthc1.md) (which is the default method on Stormpath clients), then you must provide a rootUrl. It is because Sauthc1 uses the request path to compute its hash.
    - ID Site makes queries on `href`s so you must also provide a rootUrl if you use it.

- `server.port`: the port on which cloudpass listens.
- `clustering`: Set to true to cluster the application in a number of procesess equals to the number of CPU cores (but not more than 4) to speed up response time.

### Persistence

- `database`: name of the database to connect to (irrelevant for SQLite).
- `username` and `password`: connection credentials.
- `options`: connection options. Cloudpass uses Sequelize internally, and this object is passed *as it is* to the Sequelize constructor. A list of available options is available in [Sequelize documentation](http://docs.sequelizejs.com/en/latest/api/sequelize/#new-sequelizedatabase-usernamenull-passwordnull-options).

:exclamation: If you choose a database other than PostgreSQL, you will need to install the corresponding client:
- MySQL or MariaDB: `npm install mysql`
- SQLite: `npm install sqlite3`
- MSSQL: `npm install tedious`

**Examples:**

Using SQLite is probably the fastest way to start playing around with Cloudpass, as it doesn't require to install a DBMS. But its limited concurrency support would probably make it unusable for a real life usage.
The following configuration will store the data in the file 'cloudpass.db', creating if necessary:

```yaml
persistence:
  options:
    dialect: sqlite
    storage: cloudpass.db
```

You can also use unix sockets and take profit of peer authentication to avoid having to provide a password in the configuration file:

```yaml
persistence:
  database: cloudpass
  options:
    dialect: postgres
    host: /var/run/postgresql
    port: 5432
```

Or for a plain old user/password authentication, with additional connection pool configuration:
```yaml
persistence:
  database: cloudpass
  username: cloudpass
  password: wouldntyouliketoknow
  options:
    dialect: postgres
    host: localhost
    pool:
      minConnections: 5
      maxConnections: 10
```

### Email

Cloudpass needs to send emails as parts of email addresses validation or password reset workflows.
The default configuration uses direct transport, which is a very good way of getting emails rejected or marked as spam.
You should use instead SMTP transport or any other supported Nodemailer transport.
- `transport.name`: name of the transport method. Leave it to `null` to use SMTP.
- `transport.options`: transport configuration
- `fields`: Optional additional email message fields such as bcc (see the [nodemailer page](https://nodemailer.com/message/))

#### SMTP

Example of an SMTP configuration that will send a copy of each email to `foo@example.com` and `bar@example.com`:
```yaml
email:
  transport:
    name: null
    options:
      direct: false
      host: smtp.example.com
      port: 587
      auth:
        user: mailer@example.com
        pass: xxxxxxx
  fields:
    bcc:
      - foo@example.com
      - bar@example.com
```

#### Other transports

See [here](https://nodemailer.com/transports/) for a list of available Nodemailer transports.
The following example will use [nodemailer-mandrill-transport](https://github.com/rebelmail/nodemailer-mandrill-transport).

- Navigate to Cloudpass installation directory and install the transport method:
  ```bash
  npm install nodemailer-mandrill-transport
  ```

- configure the transport (see the transport documentation for available configuration options):
  ```yaml
  email:
    transport:
      name: nodemailer-mandrill-transport
      options:
        auth:
          apiKey: XXXXXXXXXXXXXX
  ```

#### Mandrill Templates

Mandrill offers the possibility to define email templates.
If you do so, you can you can pass your Mandrill template slug to Cloudpass, e.g:
```
POST /v1/emailTemplates/2da1a3ae-2dcf-4390-b256-d0e8e86a4642
{
  "mandrillTemplate" :"welcome-email"
}
```
You can use in Mandrill templates the same Handlebars placeholders as when you define templates directly in Cloudpass, but they must be lowercased due to Mandrill limitations:
- `{{account.givenname}}`
- `{{account.surname}}`
- `{{account.fullname}}`
- `{{account.username}}`
- `{{account.email}}`
- `{{account.directory.name}}`
- `{{this.url}}` (the use of `this` is necessary because `url` is also the name of a Handlebars helper function)
- `{{cptoken}}`
- `{{cptokennamevaluepair}}`

Invitation emails can additionnaly use the following placeholders:
- `{{application.name}}`
- `{{organization.name}}`
- `{{organization.namekey}}`
- `{{organization.description}}`
- `{{fromAccount.givenName}}`
- `{{fromAccount.fullName}}`
- `{{fromAccount.surname}}`
- `{{fromAccount.username}}`
- `{{fromAccount.email}}`

### Logging

Loggers can be configured in the *logging* section:
- *audit*: auditing trail,
- *sql*: SQL queries before execution,
- *http*: HTTP requests via [morgan](https://github.com/expressjs/morgan),
- *email*: sent emails,
- *sso*: SSO operations,
- *gc*: GC pauses (configure warning and error durations in the `gc` section)

Each logger can use multiple [transports](https://github.com/winstonjs/winston/blob/master/docs/transports.md).
- Currently, supported transports are:
  - standard winston transports (`console`, `file`, `http`, `stream`)
  - `sentry`
  - `graylog_ovh`
- Default transports without configuration (e.g. a naked `console`) can be omitted.
- Non-default transports have to define their module. See `src/helpers/logging_transports`.

For example:
```yaml
logging:
  transports:
    sentry:
      module: sentry
      dsn: ...
      level: error
    graylog:
      module: graylog_ovh
      graylogHost: ...
      graylogOvhTokenValue: ...
      level: info
    graylog_audit:
      module: graylog_ovh
      graylogHost: ...
      graylogOvhTokenValue: ...
      level: info
  loggers:
    audit:
      transports: [console, sentry, graylog_audit]
      level: info
    sql:
      transports: [console, sentry, graylog]
      level: info
    http:
      transports: [console, sentry, graylog]
      level: info
    email:
      transports: [console, sentry, graylog]
      level: info
    sso:
      transports: [console, sentry, graylog]
      level: info
    gc:
      transports: [console, sentry, graylog]
      level: warn
```

## Getting Started

For now we will use [cURL](https://curl.haxx.se), a command line http client available for all platforms. But hopefuly these steps will soon be made easier by a user interface !

The first step is to create a tenant, with yourself as administrator. You must provide for this a tenant name, your email, given name, surname and a password.
Your password must be at least 8 character-long, have at least 1 upper case, 1 lower case and 1 numeric character.
```bash
curl --data "tenantNameKey=test-tenant&email=test@example.com&givenName=test&surname=test&password=xXx010xXx" http://localhost:10010/registration
```

Then login to start a session:
```bash
curl -c cloudpass-cookie.txt --data "tenantNameKey=test-tenant&email=test@example.com&password=xXx010xXx" http://localhost:10010/login
```

This will save a session cookie in `cloudpass-cookie.txt`. You can use it to query the REST API, for instance to see your account:
```bash
curl -L -b cloudpass-cookie.txt http://localhost:10010/v1/accounts/current
```

Look at the `href` property of the returned JSON: you can use it to create an API key linked to your account. Don't forget to change the account URI in the command below !
```bash
curl -X POST -b cloudpass-cookie.txt http://localhost:10010/v1/accounts/320c2ac9-913a-4711-813e-78ef04695ddb/apiKeys
```

Make a note of the `id` and `secret` properties in the object returned, you will need them to configure your client.
You can also use them instead of cookies to authenticate your requests.
For instance, if the id key is *e777909e-854b-4464-bd2c-55f951029c33* and the secret is *sFdJN5p2EbT5iSls76vt4x1yyHKAyIq4rvGlzn9mSnj8eYrx5B*:
```bash
curl -L -u e777909e-854b-4464-bd2c-55f951029c33:sFdJN5p2EbT5iSls76vt4x1yyHKAyIq4rvGlzn9mSnj8eYrx5B http://localhost:10010/v1/tenants/current
```


## Features

### REST API

The currently implemented REST API is described [here](http://dhatim.github.io/cloudpass).
The list of features is:
- CRUD on Tenant with custom data and to invite users,
- CRUD on application, custom data, accounts and groups, reset password,
- Account policies
- CRUD on API keys
- CRUD on organizations, and account stores.
- Manage sites,
- CRUD on directories, custom data and linkage with accoutn and organization,
- CRUD on groups, custom data,
- CRUD on group memberships,
- Mail templating,
- CRUD on password manangement

## Clients

Cloudpass implements the Stormpath REST API. It means that you can use any of the [Stormpath open source clients](https://docs.stormpath.com/home/) in your application to communicate with Cloudpass.
Just make sure to configure the client with a base url pointing to your Cloudpass instance.
Example for Java:
```java
Client client = Clients.builder()
                .setBaseUrl("http://localhost:10010/v1")
                .setApiKey(apiKey)
                .build();
```

## ID sites

Cloudpass supports ID sites.
The default one is [https://id.stormpath.io](https://id.stormpath.io), but you can configure it by changing the `url` attribute of your tenant's `Idsite` resource.
You can read more about ID sites on Stormpath's website.

## What's missing ?

Cloudpass is a work in progress and these features are not yet available. Let us know if you need them !
- A user interface
- Social login (other than SAML)
- Oauth token generation
- Email white & black listing

## Development

First, make sure the devDependencies are installed: `npm install`

### Testing

- To run unit tests: `npm run test:unit`
- To run integration tests: `npm run test:integration`
- To run both: `npm test`

This will produce coverage reports in `build/reports/coverage`.

[Mocha's `spec` reporter](http://mochajs.org/#spec) is used by default. To use a different reporter, you can change the `mocha_reporter` npm config key.
For example to use [mocha-sonar-generic-test-coverage-file](https://github.com/qingguo-yu/mocha-sonar-generic-test-coverage-file):
```bash
#install & configure sonar generic test coverage reporter
npm install mocha-sonar-generic-test-coverage-file
npm config set cloudpass:mocha_reporter mocha-sonar-generic-test-coverage-file

#run unit & integration tests separately to get distinct report files
GUNIT_FILE=build/reports/ut_report.xml npm run test:unit
GUNIT_FILE=build/reports/it_report.xml npm run test:integration
```

### Debian packaging

`npm run deb` will build a debian package in the `build` directory.

If you are a member of Dhatim organization on bintray, you can upload new versions in the debian repository:
- set the environment variables `BINTRAY_NAME` (your bintray username) and `BINTRAY_KEY` (your bintray API key)
- run `npm run deploy-deb`


### Releasing

If you have write accesses to the github repository, you make releases by simply running `npm version <newversion>` or [any of the alternative syntaxes](https://docs.npmjs.com/cli/version).
This will:
- run the tests locally
- bump the version in package.json, commit, tag and push
- from there, travis-ci will automatically build and publish a new version of the debian package.
