# Integrations Guide
## An important warning
Any integration you choose to install can interact with OptiDesk over it's API. It can:
- create and delete tickets
- send messages as someone, recieve messages on behalf of someone, or stream them over a third-party service (e.g a phone system)
- inject messages into the queue

Point blank - it's dangerous. Read the source code of an integration before you consider using it. Integrations also pose limited security risks.

**Any integrations in this folder will activate on startup, provided `cintegrationsEnabled` is `true`.**
## Integration format
TBD
## Managing integrations
TBD
## Scopes