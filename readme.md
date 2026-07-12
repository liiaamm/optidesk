<!-- You must be really lost if you're here... -->
<h1 align="left">
  <img src="./assets/optidesk.png" alt="OptiDesk" width="200px" height="50px">
</h1>
<h4>Enterprise-grade Discord ticketing that just works (and looks good!)</h4>

![CI](https://img.shields.io/github/actions/workflow/status/liiaamm/OptiDesk/ci.yml?style=plastic) ![Alpha](https://img.shields.io/badge/status-experimental%20alpha-red?style=plastic)

**[Introduction](#introduction)** · **[Architecture](#architecture)** · **[Installation](#installation)** · **[Guild Configuration](#guild-configuration)** · **[License & Contributions](#license--contributions)**

> [!NOTE]
> This branch is depreciated and will be deleted.

----

## Introduction
**OptiDesk** is a versatile Discord-based ticketing and request management bot that helps you manage, organise and process tickets in your server, with customisability and reliability at its core. Unlike other solutions, OptiDesk includes features such as Intellitag (deterministic keyword matching to help resolve requests or get required details for staff), Flagging (CX warnings, Priority Roles) and other intelligent features to get your staff on the ground running.

## Architecture
**OptiDesk** is event-driven and relies on the Discord gateway through [`discord.js`](https://discord.js.org/) for communication, then validates and forwards requests through `events/interactionCreate.js`. 

OptiDesk supports multiple database engines:
- **AWS DynamoDB:** (Default) The only production-tested engine. Local deployment via `dynamodb-local` out of the box; cloud-native NoSQL when using `--cloud` mode for high-availability enterprise use.
- **SQLite / PostgreSQL:** ⚠️ **EXPERIMENTAL - not production-tested.** These exist for contributors and the curious, not for anything you care about staying up. Not suitable for production use. Best-effort compatability provided, but not guaranteed.

### Cloud-Backed & Integrations
OptiDesk strongly encourages the use of the following integrations:
- [PostHog](https://posthog.com/) for analytics and error tracking.
- [Instatus](https://instatus.com/) for uptime monitoring.
- [AWS S3](https://aws.amazon.com/s3/) for unlimited transcript storage.

In `--cloud` mode, OptiDesk uses [SSM Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html) for credentials management instead of `.env` or `config.json`.

## Installation
You'll need to decide which profile to use:
- **Local** (default)

  The configuration & database for your OptiDesk instance stays on the server. Good if you just need it up and running. You can additionally enable PostHog, Instatus, or S3 if you wish at any time - they do not depend on it being local.

- **Cloud**

  *Not recommended for the inexperienced*. The configuration, database, logging and otherwise are shifted to AWS cloud infrastructure. This is best for production deployments that need high-availability for OptiDesk, changes to configuration through DynamoDB's editor on the web, that require Systems Manager Parameter Store for keeping secrets off the machine, and other needs.

There is also a `--dev` profile that will rely on either the `config.json` or SSM and keep the database in memory for testing, but it **should not be used on any deployment** as **the database is IN MEMORY**. No instructions will be provided on how to use this.

### Automated Installation/Script

We recommend using the automated deployment script so you don't have to go through manual setup. The script will ask you a few questions on how you want your OptiDesk instance to be configured, then configure PM2 for you! The script is compatible with most MacOS/Linux distributions, and can be run by running the following commands on the target machine:
```bash
git clone https://github.com/liiaamm/optidesk.git
cd optidesk
./deploy.sh
```
The script pauses for you to review `data/guild-config.json` and replace Discord channel and role placeholders before it starts the bot.

### Local Installation
Sidenote: the commands assume a bash shell. If you're running this somewhere else, you'll likely need to change certain commands.
1. **Install dependencies**

    OptiDesk requires the following:
      - [Node.js 20+](https://nodejs.org/en/download)
      - A [Discord application](https://discord.com/developers/applications) & bot token

    *external links are not verified by OptiDesk, use at own risk*

2. **Pull OptiDesk & install modules**

    Clone the repository and switch to its directory:

    ```bash
    git clone https://github.com/liiaamm/optidesk.git
    cd optidesk
    ```

    Then using `npm`, install the required modules:

    ```bash
    npm ci
    ```

3. **Configure secrets**

    **Keep your secrets safe. Reset them immediately if you think someone else has them. Anyone with your secrets can take actions under the bot.**

    Make a copy of `config.example.json` and rename it to `config.json`.
    ```bash
    cp config.example.json config.json
    ```

    Using a text editor, fill in the following constants in the newly created `config.json`:

    `token` - Your Discord bot token that OptiDesk will run under. Don't show anyone this!

    `clientId` - Your Application ID from the Discord Developers website.

    `guildId` - The guild you plan on running the bot in. If it's multiple, then pick a random one. You can't go wrong!

    If you haven't already, also **add the bot to your server** with the `Administrator` permission. It's not strictly required however - select best-fit permissions.

    You must also enable the **Server Members Intent** and **Message Content Intent** under your application's **Bot** settings on the Discord Developers website.

4. **Configure OptiDesk**

    Switch your working directory to `./data`, then copy `guild-config.example.json` and rename it to `guild-config.json`.
    ```bash
    cd data
    cp guild-config.example.json guild-config.json
    ```

    Using a text editor, modify the newly created `guild-config.json` file to your liking. The example is a minimal version, but you can go way beyond. However, at minimum, you must replace the following placeholders:

    `channelId` - The root channel that ticket threads are made from. When you configure this in Discord, ensure **everyone** can `View Channel` otherwise OptiDesk cannot add them.

    `inboxId` - The inbox channel where staff are notified about new tickets. Your staff should be able to see this.

    `staffRoleId` - Your staff role - who should be able to access and manage tickets.

    That is the **minimum** required. If you set `settings.addNonStaffToTickets` to `false`, only members with staff access to the ticket's category (its `staffRoleId`, its `supervisorRoleId`, or the global `supervisorRoleID`) can be added to tickets. OptiDesk can handle a significant magnitude more - tinker with the settings! To change the guild configuration later, change `data/guild-config.json` and restart the bot. In local single-tenant mode, OptiDesk syncs that file into the guild configuration record on startup without touching ticket data.

5. **Register commands**

    Register the OptiDesk commands using `deploy-commands.js`.

    ```bash
    node deploy-commands.js
    ```

    When prompted, select `3` - you are using the local, config.json for your secrets in this path.

6. **Upload emojis**

   Upload the emojis required for OptiDesk to work. You can change the colour of almost all of them. Use the following command.

   ```bash
   npm run emojis -- --color "#9DE8E4" --upload --prefix local_ --set SelfHostEmojis
   ```

   Replace the hex, prefix (as shown in the emoji name) and set name as needed. The script updates `utils/emojis.js` with the uploaded emoji IDs. Then set `appearance.emojiSet` in `data/guild-config.json` to the set name you used.

7. **Run the bot**

    Run the bot by using node.

    ```bash
    node .
    ```

    We highly recommend using something like [PM2](https://pm2.keymetrics.io/) so an accidental shutoff or error doesn't stop your instance.

8. Optional: **Configure Transcription**

    Transcription relies on AWS S3. To enable Transcription, you need an S3 bucket and AWS credentials on the machine. To enable it, change the following in `config.json`:

    ```json
    "storage": { "type": "s3", "bucket": "your-bucket-name", "region": "your-region" }
    ```

    substituting accordingly. Then, enable transcripts in your guild configuration (`settings.transcriptsEnabled`).


### Cloud Installation


> [!NOTE]
> You should be familiar with how AWS cloud infrastructure works and be willing to accept that **AWS is a paid service** and nothing is entirely free.

> [!CAUTION]
> Your token should be a SecureString - do NOT leave it in plain text.


OptiDesk **requires** at minimum, 6 **DynamoDB** tables configured, with the names substituted inside `utils/constants.js`. You don't need to configure `OptiDeskPerformance` if you don't need to.

Cloud mode reads credentials from SSM Parameter Store and does not use `config.json`. OptiDesk additionally **requires** the following SSM parameters:

```
/optidesk/prod/token
/optidesk/prod/clientId
/optidesk/prod/guildId
/optidesk/prod/instatusHeartbeatUrl
/optidesk/prod/posthogKey
```

To access AWS cloud infrastructure, the machine must have ambient AWS credentials. You can do this from EC2 by assigning a role to the instance, or by authenticating with an access key on a non-EC2 compute instance or server.

If you are doing a Cloud Installation, you need to complete steps 1-2, 5 (selecting `1` for cloud deployment of commands using SSM credentials), and 6 with `node . --cloud`.

We highly recommend hooking up PostHog in a Cloud Installation.

### Guild Configuration
The guild configuration schema is `data/guild-config.schema.json`, which includes the vast amount of things you can change about OptiDesk.

## License & Contributions
### License
This project is licensed under the **[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html)**. If you make changes to the source code of this program, *they must be open-source too*. Contributions are only accepted under `AGPL-3.0-or-later`. By contributing, you explicitly grant us rights to use your contribution under the `AGPL-3.0-or-later`.

### Contributions
Contributions are welcome: please see `CONTRIBUTING.md`, `CODEOFCONDUCT.md`, and the above licensing.

### Suggestions & Reports

> [!CAUTION]
> ***DO NOT REPORT VULNERABILITIES THROUGH ANY PUBLIC CHANNEL, INCLUDING GITHUB ISSUES. PLEASE SEE `SECURITY.md`***

Please use [GitHub Issues](https://github.com/liiaamm/optidesk/issues) for any suggestions or bug reports. Use the correct tag, please, and provide as much detail as possible.

----
*Developed with love from Australia*
