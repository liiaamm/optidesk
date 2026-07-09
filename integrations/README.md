<h1 align="left">
  <img src="../assets/optidesk.png" alt="OptiDesk" width="200px" height="50px">
</h1>
<h3>Integrations Manual</h3>

**[(READ ME!) An important warning](#an-important-warning)** · **[Integration format](#integration-format)** · **[Managing integrations](#managing-integrations)** · **[Other functions](#other-functions)** · **[Scopes](#scopes)**

----

## An important warning
Any integration you choose to install can interact with OptiDesk over it's API. It can:
- create and delete tickets
- send messages as someone, recieve messages on behalf of someone, or stream them over a third-party service (e.g a phone system)
- inject messages into the queue
- recieve data when you use OptiDesk, including metadata

Point blank - it's dangerous. Read the source code of an integration before you consider using it. Integrations also pose limited security risks.

**Any integrations in this folder will activate on startup, provided `integrationsEnabled` is `true`, the integration is enabled through the CLI, and `settings.integrationsEnabled` is `true` for the specific guild.**
## Integration format
Integrations should be in the `./integrations` subfolder, where the integration has its own folder. Inside, an index.js should contain the relevant integration code & call site for setup, & an integration.json file. 
```
/integrations
> your_cool_integration
  | index.js
  | integration.json
```
The integration.json file should have the following attributes set:
```json
{
    "type": "OptiDesk Integration", // Unused but required
    "apiVersion": 1, // Internal API expected by your integration
    "scopes": ["instance.info"],
    "commands": "commands.js"
}
```
Integrations are loaded into context and, when an event fires, OptiDesk will call your integration.
## Managing integrations
### Installing an integration (through git)
We highly reccommend installing and packaging integrations as git repositories.
1. Pull the repository of the integration
   
    Pull the remote repository using it's .git link to the `./integrations` directory:
    ```bash
    cd integrations
    git clone <URL to repository>
    ```
    On GitHub, the URL for the repository is typically `https://github.com/authorusername/repositoryname.git`.

2. Install its dependencies

    From the integration directory, install its dependencies:
    ```bash
    npm install
    ```

3. Register it with OptiDesk
    
    Using the `integrations` npm script, register the integration using the repository name as shown in the new folder in `./integrations`:
    ```bash
    npm run integrations register <Integration name>
    ```

    You'll then be asked to approve the scopes that the integration has requested to use on your OptiDesk instance. **Read carefully.** 

    The integration will be automatically enabled!

### Removing an integration
1. Deregister it with OptiDesk
    
    Using the `integrations` npm script, remove the integration using the repository name:
    ```bash
    npm run integrations remove <Integration name>
    ```

2. (Optional) Remove the remaining files
    
    Remove the directory containing the integration's files (typically the repository name) from `./integrations`.

    The `remove` command *won't* do this for you.

### Other functions
If you need to `enable`, `disable`, `list` integrations or `rotate-token` on a specific integration's remote token, hitherto commands will function with the `integrations` npm script. 

## Scopes

> [!NOTE]
> We're currently integrating scopes carefully as to avoid security or integrity risks, but we're also adding more in the future.

The current available scopes for OptiDesk integrations (`apiVersion: 1`) are as follows.

### Core
#### `instance.info`
Allows the integration to use `ctx.instance` methods: currently, only to retrieve the version of OptiDesk running on the instance using `ctx.instance.info()`. 

An example output of `instance.info()`'s result:
```json
{
    version: '0.5.1'
}
```
#### `events.subscribe`
Allows the integration to subscribe to **any** event fire from OptiDesk. Event fires include context - this brings [security risks](#an-important-warning).

Integrations can register events on startup using `module.exports.setup` in their `index.js`:
```js
module.exports.setup = async (ctx) => {
    ctx.events.on('ticket.claimed', (event) => {
        console.log(event); // Returns: { ticketId, guildId, claimedBy, category }
    });
}
```

#### `tickets.write`
Allows the integration to create tickets, including as someone. 

#### `commands.register`
