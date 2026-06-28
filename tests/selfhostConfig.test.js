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
