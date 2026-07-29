const fs = require('node:fs');
const path = require('node:path');

test('self-host guild config example includes safe open-ticket banner defaults', () => {
    const configPath = path.join(__dirname, '..', 'data', 'guild-config.example.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    expect(config.layout?.presets?.openTicket?.banner).toEqual(expect.objectContaining({
        url: null,
        altText: expect.any(String),
    }));
    expect(config.layout.presets.openTicket.banner.altText.length).toBeGreaterThan(0);
});

// The generated emoji set lives in the gitignored copy so updates can't wipe it.
// If utils/emojis.js is ever tracked again, self-hosts silently lose their emojis
// on the next update and fall back to OptiDeskEmojis IDs that can't render.
test('emoji set ships as an example and the live copy stays gitignored', () => {
    const root = path.join(__dirname, '..');
    const example = require(path.join(root, 'utils', 'emojis.example.js'));

    expect(Object.keys(example.OptiDeskEmojis).length).toBeGreaterThan(0);

    const ignored = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n').map(line => line.trim());
    expect(ignored).toContain('utils/emojis.js');
});
