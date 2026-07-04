#!/usr/bin/env node
/*
 * Generate a self-host OptiDesk emoji pack.
 *
 * The script renders every Material Symbols icon referenced in utils/emojis.js
 * in a chosen colour, copies bundled system emojis into the pack, optionally
 * uploads all of them as Discord application emojis, updates utils/emojis.js,
 * and prints the generated set block.
 *
 * Usage:
 *   npm run emojis -- --color "#9DE8E4" --out ./emoji-packs/local
 *   npm run emojis -- --color "#9DE8E4" --upload --prefix local_ --set SelfHostEmojis --dev
 *
 * Flags:
 *   --color <hex>       Fill colour for Material Symbols. "#" optional.
 *   --out <dir>         Output directory. Default: ./emoji-packs/<hex>
 *   --size <px>         PNG width/height. Default: 500
 *   --force             Overwrite generated files and replace uploaded emojis.
 *   --upload            Upload generated and system emojis as application emojis.
 *   --prefix <text>     Prefix for uploaded emoji names, e.g. "local_".
 *   --set <identifier>  Emoji set name printed for utils/emojis.js.
 *   --system-dir <dir>  Directory containing system emoji manifest/assets.
 *   --no-system         Do not include bundled system emojis.
 *   --dev[=src]         Forwarded to utils/config for local config loading.
 */

// NOTE: This is a fully-AI generated tool. As with all code, especially AI-generated
// code, this has been reviewed.

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const EMOJIS_JS_PATH = path.join(ROOT, 'utils', 'emojis.js');
const DEFAULT_SYSTEM_DIR = path.join(ROOT, 'emoji-assets');
const DEFAULT_SET_NAME = 'SelfHostEmojis';
const DISCORD_EMOJI_MAX_BYTES = 256 * 1024;
const ICON_RE = /"([^"]+)"\s*:\s*\{[^}]*?\/\/\s*(material-symbols:[a-z0-9-]+)/gi;

function printHelp() {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 24).join('\n'));
}

function normalizeHex(value) {
    const hex = String(value || '').trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(hex)) {
        return hex.split('').map(ch => ch + ch).join('');
    }
    if (/^[0-9a-f]{6}$/.test(hex)) return hex;
    throw new Error(`Invalid hex colour "${value}". Use RGB/RRGGBB, with or without "#".`);
}

function validateIdentifier(value, label) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)) {
        throw new Error(`${label} must be a valid JavaScript identifier. Received "${value}".`);
    }
    return value;
}

function parseArgs(argv) {
    const args = {
        color: 'ffffff',
        dir: null,
        force: false,
        includeSystem: true,
        prefix: '',
        setName: DEFAULT_SET_NAME,
        size: 500,
        systemDir: DEFAULT_SYSTEM_DIR,
        upload: false,
    };

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--color') args.color = normalizeHex(argv[++i]);
        else if (arg === '--out') args.dir = argv[++i];
        else if (arg === '--size') args.size = Number.parseInt(argv[++i], 10);
        else if (arg === '--force') args.force = true;
        else if (arg === '--upload') args.upload = true;
        else if (arg === '--prefix') args.prefix = argv[++i];
        else if (arg === '--set') args.setName = validateIdentifier(argv[++i], '--set');
        else if (arg === '--system-dir') args.systemDir = path.resolve(argv[++i]);
        else if (arg === '--no-system') args.includeSystem = false;
        else if (arg === '--dev' || arg.startsWith('--dev=')) { /* consumed by utils/config */ }
        else if (arg === '-h' || arg === '--help') {
            printHelp();
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    args.color = normalizeHex(args.color);
    if (!Number.isFinite(args.size) || args.size <= 0) {
        throw new Error('--size must be a positive number');
    }
    if (!args.dir) args.dir = path.join('emoji-packs', args.color);
    args.dir = path.resolve(process.cwd(), args.dir);
    return args;
}

function extractMaterialIcons(source) {
    const seen = new Map();
    let match;
    while ((match = ICON_RE.exec(source)) !== null) {
        const [, key, icon] = match;
        if (!seen.has(key)) seen.set(key, icon.replace('material-symbols:', ''));
    }
    return seen;
}

function fetchBuffer(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'optidesk-emoji-pack-generator' } }, res => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return fetchBuffer(res.headers.location).then(resolve, reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

function svgToPng(svgBuffer, size) {
    let Resvg;
    try {
        ({ Resvg } = require('@resvg/resvg-js'));
    } catch {
        throw new Error('Missing dependency: run `npm install` before generating emoji packs.');
    }
    const resvg = new Resvg(svgBuffer, { fitTo: { mode: 'width', value: size } });
    return resvg.render().asPng();
}

function sanitizeEmojiName(raw) {
    const sanitized = String(raw)
        .replace(/[^A-Za-z0-9_]/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 32);
    if (sanitized.length >= 2) return sanitized;
    return `${sanitized || 'od'}_emoji`.slice(0, 32);
}

async function generateMaterialPngs(icons, args) {
    const entries = [];
    let generated = 0;
    let skipped = 0;
    let failed = 0;

    fs.mkdirSync(args.dir, { recursive: true });
    console.log(`Generating ${icons.size} Material Symbols at ${args.size}x${args.size} in #${args.color} -> ${args.dir}\n`);

    for (const [key, iconName] of icons) {
        const dest = path.join(args.dir, `${key}.png`);
        if (!args.force && fs.existsSync(dest)) {
            const png = fs.readFileSync(dest);
            entries.push({ key, iconName, png, file: dest, source: 'material' });
            console.log(`  - ${key} (exists, skipped)`);
            skipped++;
            continue;
        }

        const url = `https://api.iconify.design/material-symbols/${iconName}.svg`
            + `?color=%23${args.color}&width=${args.size}&height=${args.size}`;
        try {
            const svg = await fetchBuffer(url);
            const png = svgToPng(svg, args.size);
            fs.writeFileSync(dest, png);
            entries.push({ key, iconName, png, file: dest, source: 'material' });
            console.log(`  + ${key.padEnd(40)} ${iconName} (${png.length} bytes)`);
            generated++;
        } catch (err) {
            console.error(`  x ${key} (${iconName}): ${err.message}`);
            failed++;
        }
    }

    console.log(`\nMaterial generation complete. ${generated} generated, ${skipped} skipped, ${failed} failed.`);
    return { entries, failed };
}

function systemKey(name) {
    return name === 'OptiDesk' ? 'optidesk' : name;
}

function copySystemEmojis(args) {
    if (!args.includeSystem) return [];

    const manifestPath = path.join(args.systemDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        console.warn(`[emoji-pack] No system emoji manifest found at ${manifestPath}; skipping system emojis.`);
        return [];
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const systemOut = path.join(args.dir, 'system');
    fs.mkdirSync(systemOut, { recursive: true });

    const entries = [];
    console.log(`\nCopying ${manifest.length} system emojis -> ${systemOut}\n`);

    for (const item of manifest) {
        const source = path.join(args.systemDir, item.file);
        if (!fs.existsSync(source)) {
            console.warn(`  x ${item.name}: missing ${source}`);
            continue;
        }

        const key = item.key || systemKey(item.name);
        const ext = path.extname(item.file) || '.png';
        const dest = path.join(systemOut, `${key}${ext}`);
        if (args.force || !fs.existsSync(dest)) {
            fs.copyFileSync(source, dest);
        }

        const png = fs.readFileSync(dest);
        entries.push({
            key,
            iconName: `system:${item.file}`,
            png,
            file: dest,
            source: 'system',
            systemName: item.name,
        });
        console.log(`  + ${key.padEnd(40)} ${path.relative(process.cwd(), dest)} (${png.length} bytes)`);
    }

    return entries;
}

function dedupeByKey(entries) {
    const seen = new Set();
    const out = [];
    for (const entry of entries) {
        if (seen.has(entry.key)) {
            console.warn(`[emoji-pack] Duplicate emoji key "${entry.key}" from ${entry.source}; keeping first occurrence.`);
            continue;
        }
        seen.add(entry.key);
        out.push(entry);
    }
    return out;
}

function discordRequest(method, urlPath, token, body) {
    return new Promise((resolve, reject) => {
        const data = body ? Buffer.from(JSON.stringify(body)) : null;
        const req = https.request({
            method,
            hostname: 'discord.com',
            path: `/api/v10${urlPath}`,
            headers: {
                Authorization: `Bot ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'optidesk-emoji-pack-generator',
                ...(data ? { 'Content-Length': data.length } : {}),
            },
        }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(text ? JSON.parse(text) : null);
                } else {
                    reject(new Error(`Discord ${method} ${urlPath} -> ${res.statusCode}: ${text}`));
                }
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function uploadAll(entries, args) {
    const { loadConfig } = require(path.join('..', 'utils', 'config.js'));
    const { token, clientId } = await loadConfig({});
    if (!token || !clientId) throw new Error('config missing token or clientId');

    console.log(`\nUploading ${entries.length} emojis to application ${clientId}...\n`);
    const existing = await discordRequest('GET', `/applications/${clientId}/emojis`, token);
    const existingItems = Array.isArray(existing) ? existing : (existing.items || []);
    const existingByName = new Map(existingItems.map(emoji => [emoji.name, emoji.id]));

    const results = [];
    let created = 0;
    let reused = 0;
    let failed = 0;

    for (const entry of entries) {
        const name = sanitizeEmojiName(args.prefix + entry.key);
        if (entry.png.length > DISCORD_EMOJI_MAX_BYTES) {
            console.error(`  x ${name}: ${entry.png.length} bytes exceeds Discord's 256KB emoji limit`);
            failed++;
            continue;
        }

        try {
            if (existingByName.has(name)) {
                if (!args.force) {
                    console.log(`  - ${name} (exists, reused)`);
                    results.push({ ...entry, name, id: existingByName.get(name) });
                    reused++;
                    continue;
                }
                await discordRequest('DELETE', `/applications/${clientId}/emojis/${existingByName.get(name)}`, token);
            }

            const image = `data:image/png;base64,${entry.png.toString('base64')}`;
            const uploaded = await discordRequest('POST', `/applications/${clientId}/emojis`, token, { name, image });
            console.log(`  + ${name}`);
            results.push({ ...entry, name, id: uploaded.id });
            created++;
            await new Promise(resolve => setTimeout(resolve, 250));
        } catch (err) {
            console.error(`  x ${name}: ${err.message}`);
            failed++;
        }
    }

    console.log(`\nUpload complete. ${created} created, ${reused} reused, ${failed} failed.`);
    return { results, failed };
}

function relativeToPack(args, filePath) {
    return path.relative(args.dir, filePath).replace(/\\/g, '/');
}

function buildEmojisJsSetDefinition(results, args) {
    const lines = [`const ${args.setName} = {`];
    for (const result of results) {
        const comment = result.source === 'material'
            ? ` // material-symbols:${result.iconName}`
            : ` // ${result.iconName}`;
        lines.push(`    "${result.key}": {${comment}`);
        lines.push(`        "id": "${result.id}",`);
        lines.push(`        "markdown": "<:${result.name}:${result.id}>",`);
        lines.push('    },');
    }
    lines.push('};');
    return lines.join('\n');
}

function buildEmojisJsBlock(results, args) {
    const lines = [buildEmojisJsSetDefinition(results, args)];
    lines.push('');
    lines.push('module.exports = {');
    if (args.setName !== 'OptiDeskEmojis') {
        lines.push('    OptiDeskEmojis,');
    }
    lines.push(`    ${args.setName},`);
    lines.push('};');
    return lines.join('\n');
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ensureSetExported(source, setName) {
    const exportRe = /module\.exports\s*=\s*\{([\s\S]*?)\};/m;
    const match = source.match(exportRe);
    if (!match) {
        return `${source.trimEnd()}\n\nmodule.exports = {\n    OptiDeskEmojis,\n    ${setName},\n};\n`;
    }

    const body = match[1];
    const exported = new Set([...body.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g)].map(m => m[1]));
    if (exported.has(setName)) return source;

    return source.replace(exportRe, `module.exports = {${body.trimEnd()}\n    ${setName},\n};`);
}

function updateEmojisJs(results, args) {
    const start = `// BEGIN GENERATED EMOJI SET: ${args.setName}`;
    const end = `// END GENERATED EMOJI SET: ${args.setName}`;
    const generated = `${start}\n${buildEmojisJsSetDefinition(results, args)}\n${end}`;

    let source = fs.readFileSync(EMOJIS_JS_PATH, 'utf8');
    const existingGeneratedRe = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
    if (existingGeneratedRe.test(source)) {
        source = source.replace(existingGeneratedRe, generated);
    } else {
        const exportRe = /\nmodule\.exports\s*=\s*\{[\s\S]*?\};\s*$/;
        const match = source.match(exportRe);
        if (match) {
            source = `${source.slice(0, match.index)}\n\n${generated}${source.slice(match.index)}`;
        } else {
            source = `${source.trimEnd()}\n\n${generated}\n`;
        }
    }

    if (args.setName !== 'OptiDeskEmojis') {
        source = ensureSetExported(source, args.setName);
    }

    fs.writeFileSync(EMOJIS_JS_PATH, source.endsWith('\n') ? source : `${source}\n`);
    console.log(`Updated utils/emojis.js with ${args.setName}.`);
}

function writePackManifest(entries, uploadResults, args) {
    const byKey = new Map(uploadResults.map(result => [result.key, result]));
    const manifest = {
        setName: args.setName,
        color: `#${args.color}`,
        prefix: args.prefix,
        generatedAt: new Date().toISOString(),
        upload: args.upload,
        entries: entries.map(entry => {
            const uploaded = byKey.get(entry.key);
            return {
                key: entry.key,
                source: entry.source,
                icon: entry.iconName,
                file: relativeToPack(args, entry.file),
                ...(uploaded ? { name: uploaded.name, id: uploaded.id } : {}),
            };
        }),
    };
    const dest = path.join(args.dir, 'emoji-pack.manifest.json');
    fs.writeFileSync(dest, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`\nWrote pack manifest: ${path.relative(process.cwd(), dest)}`);
}

function printUploadOutput(results, args, expectedEntries) {
    if (!results.length) return;

    const block = buildEmojisJsBlock(results, args);
    const snippetPath = path.join(args.dir, `${args.setName}.emojis.js`);
    fs.writeFileSync(snippetPath, `${block}\n`);
    updateEmojisJs(results, args);

    console.log(`Wrote utils/emojis.js snippet: ${path.relative(process.cwd(), snippetPath)}`);
    console.log('\n// --- utils/emojis.js set block ---\n');
    console.log(block);
    console.log('\n// --- guild config ---');
    console.log(`// Set appearance.emojiSet to "${args.setName}" and appearance.defaultHexColor to "${args.color.toUpperCase()}".`);

    const uploadedKeys = new Set(results.map(result => result.key));
    const missing = expectedEntries.filter(entry => !uploadedKeys.has(entry.key)).map(entry => entry.key);
    if (missing.length) {
        console.warn(`\n[emoji-pack] Missing uploaded keys: ${missing.join(', ')}`);
    }
}

async function main() {
    const args = parseArgs(process.argv);
    const emojiSrc = fs.readFileSync(EMOJIS_JS_PATH, 'utf8');
    const icons = extractMaterialIcons(emojiSrc);

    if (icons.size === 0) {
        throw new Error('No `// material-symbols:...` comments found in utils/emojis.js');
    }

    const material = await generateMaterialPngs(icons, args);
    const system = copySystemEmojis(args);
    const entries = dedupeByKey([...material.entries, ...system]);

    writePackManifest(entries, [], args);

    if (args.upload) {
        const upload = await uploadAll(entries, args);
        writePackManifest(entries, upload.results, args);
        printUploadOutput(upload.results, args, entries);
        if (material.failed || upload.failed) process.exit(1);
        return;
    }

    console.log(`\nGenerated ${entries.length} emoji assets. Re-run with --upload to create application emojis and generate the utils/emojis.js set block.`);
    if (material.failed) process.exit(1);
}

main().catch(err => {
    console.error(err.message || err);
    process.exit(1);
});
