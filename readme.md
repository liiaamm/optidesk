<!-- You must be really lost if you're here... -->
<h1 align="left">
  <img src="./assets/optidesk.png" alt="The OptiDesk wordmark." width="200px" height="50px">
</h1>
<h4>Enterprise-grade Discord ticketing that just works (and looks good!)</h4>

[![CI](https://github.com/liiaamm/optidesk/actions/workflows/ci.yml/badge.svg)](https://github.com/liiaamm/optidesk/actions/workflows/ci.yml)

**[Introduction](#introduction)** · **[Architecture](#architecture)** · **[Installation](#installation)** · **[Guild Configuration](#guild-configuration)** · **[License & Contributions](#license--contributions)**

----

## Introduction
**OptiDesk** is a versatile Discord-based ticketing and request management bot that helps you manage, organise and process tickets in your server, with customisability and reliability at its core. Unlike other solutions, OptiDesk includes features such as Intellitag (deterministic keyword matching to help resolve requests or get required details for staff), Flagging (CX warnings, Priority Roles) and other intelligent features to get your staff on the ground running.

## Architecture
**OptiDesk** is event-driven and relies on the Discord gateway through [`discord.js`](https://discord.js.org/) for communication, then validates and forwards requests through `events/interactionCreate.js`. 

OptiDesk supports multiple database engines:
- **SQLite:** (Default) Zero-configuration local database perfectly suited for single-server or moderate usage.
- **PostgreSQL:** Scalable global database for massive deployments or high concurrency.
- **AWS DynamoDB:** Cloud-native NoSQL database designed for high-availability enterprise use (when using `--cloud` mode).

### Cloud-Backed & Integrations
OptiDesk strongly encourages the use of the following integrations:
- [PostHog](https://posthog.com/) for analytics and error tracking.
- [Instatus](https://instatus.com/) for uptime monitoring.
- [AWS S3](https://aws.amazon.com/s3/) for unlimited transcript storage.

In `--cloud` mode, OptiDesk uses [SSM Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html) for credentials management instead of `.env` or `config.json`.

## Installation

### The 1-Step Deployment script
OptiDesk is incredibly simple to set up! We provide a cross-platform (Linux/macOS) interactive installation script that will:
- Check that NodeJS and PM2 are installed
- Clone the repository
- Ask you a few questions about your bot (Tokens, Database preference)
- Automatically deploy the slash commands to Discord
- Automatically boot up the bot in the background using PM2

**Just run this command in your terminal:**
```bash
curl -sL https://raw.githubusercontent.com/atriasfty/optidesk/main/deploy.sh | bash
```

Once the script finishes, check Discord! Your bot should be online.

## Guild Configuration

You no longer have to manually edit JSON files to configure your server's settings! OptiDesk comes with a powerful **In-Discord Configuration Panel**.

1. In your server, run the `/config` slash command.
2. Ensure you are the Server Owner or have been granted the Admin Role.
3. Use the interactive menu to map your **Staff Roles**, **Ticket Channels**, **Transcript settings**, and more!
4. Settings are instantly updated in the database and take effect immediately. No restarts required.

## License & Contributions
### License
This project is licensed under the **[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html)**. If you make changes to the source code of this program, *they must be open-source too*. Contributions are only accepted under `AGPL-3.0-or-later`. By contributing, you explicitly grant us rights to use your contribution under the `AGPL-3.0-or-later`.

### Contributions
Contributions are welcome: please see `CONTRIBUTING.md`, `CODEOFCONDUCT.md`, and the above licensing.

### Suggestions & Reports

> [!CAUTION]
> ***DO NOT REPORT VULNERABILITIES THROUGH ANY PUBLIC CHANNEL, INCLUDING GITHUB ISSUES. PLEASE SEE `SECURITY.md`***

Please use [GitHub Issues](https://github.com/atriasfty/optidesk/issues) for any suggestions or bug reports. Use the correct tag, please, and provide as much detail as possible.

----
*Developed with love from Australia*
