const fs = require('fs');
const path = require('path');

const { 
    TABLE_TICKETS, TABLE_CONFIGS, TABLE_LICENSING, 
    TABLE_ENFORCEMENT, TABLE_ENFORCEMENT_GUILDS, 
    TABLE_PERFORMANCE, TABLE_TRANSCRIPTS 
} = require('./constants');

const TABLES = [
    TABLE_TICKETS, TABLE_TRANSCRIPTS, TABLE_CONFIGS, 
    TABLE_ENFORCEMENT, TABLE_ENFORCEMENT_GUILDS, 
    TABLE_LICENSING, TABLE_PERFORMANCE
];

const PK_MAP = {
    [TABLE_TICKETS]: 'channelId',
    [TABLE_CONFIGS]: 'guildId',
    [TABLE_LICENSING]: 'licenseId',
    [TABLE_TRANSCRIPTS]: 'ticketId',
    [TABLE_ENFORCEMENT]: 'id',
    [TABLE_ENFORCEMENT_GUILDS]: 'guildId',
    [TABLE_PERFORMANCE]: 'timestamp' 
};

class SqlDocumentClient {
    constructor(config) {
        this.dialect = config.type === 'sqlite' ? 'sqlite' : 'postgresql';
        if (this.dialect === 'postgresql') {
            const { Pool } = require('pg');
            this.pool = new Pool({ connectionString: config.postgresUrl });
        } else {
            const Database = require('better-sqlite3');
            const dbPath = config.sqlitePath || './data/optidesk.db';
            const dbDir = path.dirname(dbPath);
            if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
            this.db = new Database(dbPath);
        }
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;
        if (this.dialect === 'postgresql') {
            for (const table of TABLES) {
                await this.pool.query(`CREATE TABLE IF NOT EXISTS ${table} (id VARCHAR(255) PRIMARY KEY, data JSONB)`);
            }
        } else {
            for (const table of TABLES) {
                this.db.prepare(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT)`).run();
            }
        }
        this.initialized = true;
    }

    async _get(table, id) {
        await this.init();
        if (this.dialect === 'postgresql') {
            const res = await this.pool.query(`SELECT data FROM ${table} WHERE id = $1`, [id]);
            return res.rows[0]?.data;
        } else {
            const row = this.db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id);
            return row ? JSON.parse(row.data) : undefined;
        }
    }

    async _set(table, id, data) {
        await this.init();
        if (this.dialect === 'postgresql') {
            await this.pool.query(
                `INSERT INTO ${table} (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
                [id, data]
            );
        } else {
            this.db.prepare(
                `INSERT INTO ${table} (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`
            ).run(id, JSON.stringify(data));
        }
    }

    async _delete(table, id) {
        await this.init();
        if (this.dialect === 'postgresql') {
            await this.pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
        } else {
            this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
        }
    }

    get(params) {
        return {
            promise: async () => {
                const pkField = Object.keys(params.Key)[0];
                const id = String(params.Key[pkField]);
                const data = await this._get(params.TableName, id);
                return { Item: data };
            }
        };
    }

    put(params) {
        return {
            promise: async () => {
                const data = params.Item;
                const pkField = PK_MAP[params.TableName] || 'id';
                let id = data[pkField];
                if (!id) {
                    id = Object.values(data).find(v => typeof v === 'string' || typeof v === 'number');
                }
                await this._set(params.TableName, String(id), data);
                return {};
            }
        };
    }

    delete(params) {
        return {
            promise: async () => {
                const pkField = Object.keys(params.Key)[0];
                const id = String(params.Key[pkField]);
                await this._delete(params.TableName, id);
                return {};
            }
        };
    }

    update(params) {
        return {
            promise: async () => {
                const pkField = Object.keys(params.Key)[0];
                const id = String(params.Key[pkField]);
                
                await this.init();

                const applyUpdate = (currentData) => {
                    let data = currentData || {};
                    if (params.UpdateExpression) {
                        const parts = params.UpdateExpression.split(' REMOVE ');
                        const setPart = parts[0].startsWith('SET ') ? parts[0].substring(4) : '';
                        const removePart = parts[1] || (params.UpdateExpression.startsWith('REMOVE ') ? params.UpdateExpression.substring(7) : '');

                        if (setPart) {
                            const setNested = (obj, path, value) => {
                                const keys = path.split('.');
                                let cur = obj;
                                for (let i = 0; i < keys.length - 1; i++) {
                                    if (!cur[keys[i]]) cur[keys[i]] = {};
                                    cur = cur[keys[i]];
                                }
                                cur[keys[keys.length - 1]] = value;
                            };
                            const getNested = (obj, path) => {
                                return path.split('.').reduce((acc, part) => acc && acc[part], obj);
                            };
                            const regex = /([\w#.]+)\s*=\s*(if_not_exists\([^)]+\)\s*\+\s*[\w:]+|[^,]+)/g;
                            let match;
                            while ((match = regex.exec(setPart)) !== null) {
                                const fieldFull = match[1];
                                const expr = match[2].trim();
                                const field = (params.ExpressionAttributeNames && fieldFull.startsWith('#')) ? params.ExpressionAttributeNames[fieldFull] : fieldFull;

                                if (expr.includes('if_not_exists')) {
                                    const m2 = expr.match(/if_not_exists\(([^,]+),\s*([^)]+)\)\s*\+\s*(.+)/);
                                    if (m2) {
                                        const [, propFull, zeroValKey, incValKey] = m2;
                                        const prop = (params.ExpressionAttributeNames && propFull.startsWith('#')) ? params.ExpressionAttributeNames[propFull] : propFull;
                                        const zeroVal = params.ExpressionAttributeValues[zeroValKey];
                                        const incVal = params.ExpressionAttributeValues[incValKey];
                                        const current = getNested(data, prop) !== undefined ? getNested(data, prop) : zeroVal;
                                        setNested(data, field, current + incVal);
                                    } else {
                                        setNested(data, field, params.ExpressionAttributeValues[expr]);
                                    }
                                } else {
                                    setNested(data, field, params.ExpressionAttributeValues[expr]);
                                }
                            }
                        }
                        if (removePart) {
                            const deleteNested = (obj, path) => {
                                const keys = path.split('.');
                                let cur = obj;
                                for (let i = 0; i < keys.length - 1; i++) {
                                    if (!cur[keys[i]]) return;
                                    cur = cur[keys[i]];
                                }
                                delete cur[keys[keys.length - 1]];
                            };
                            const fields = removePart.split(',').map(s => s.trim());
                            for (const f of fields) {
                                const actualF = (params.ExpressionAttributeNames && f.startsWith('#')) ? params.ExpressionAttributeNames[f] : f;
                                deleteNested(data, actualF);
                            }
                        }
                    }
                    return data;
                };

                if (this.dialect === 'postgresql') {
                    const client = await this.pool.connect();
                    try {
                        await client.query('BEGIN');
                        const res = await client.query(`SELECT data FROM ${params.TableName} WHERE id = $1 FOR UPDATE`, [id]);
                        let data = applyUpdate(res.rows[0]?.data);
                        
                        await client.query(
                            `INSERT INTO ${params.TableName} (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
                            [id, data]
                        );
                        await client.query('COMMIT');
                        return { Attributes: data };
                    } catch (e) {
                        await client.query('ROLLBACK');
                        throw e;
                    } finally {
                        client.release();
                    }
                } else {
                    const transaction = this.db.transaction(() => {
                        const row = this.db.prepare(`SELECT data FROM ${params.TableName} WHERE id = ?`).get(id);
                        let data = applyUpdate(row ? JSON.parse(row.data) : undefined);
                        this.db.prepare(
                            `INSERT INTO ${params.TableName} (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`
                        ).run(id, JSON.stringify(data));
                        return data;
                    });
                    const resultData = transaction();
                    return { Attributes: resultData };
                }
            }
        };
    }

    query(params) {
         return {
             promise: async () => {
                 await this.init();
                 const condition = params.KeyConditionExpression; 
                 const [fieldFull, op, valKey] = condition.split(' ');
                 const actualField = (params.ExpressionAttributeNames && fieldFull.startsWith('#')) ? params.ExpressionAttributeNames[fieldFull] : fieldFull;
                 const val = String(params.ExpressionAttributeValues[valKey]);

                 if (this.dialect === 'postgresql') {
                     const res = await this.pool.query(
                         `SELECT data FROM ${params.TableName} WHERE data->>$1 = $2`,
                         [actualField, val]
                     );
                     return { Items: res.rows.map(r => r.data) };
                 } else {
                     const rows = this.db.prepare(
                         `SELECT data FROM ${params.TableName} WHERE json_extract(data, '$.' || ?) = ?`
                     ).all(actualField, val);
                     return { Items: rows.map(r => JSON.parse(r.data)) };
                 }
             }
         };
    }
}

module.exports = SqlDocumentClient;
