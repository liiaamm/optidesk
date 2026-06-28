'use strict';

const readline = require('node:readline');

const w = (text) => process.stdout.write(text);
const isTTY = () => true;

const DEFAULT_STEPS = [
    ['Initializing client', Promise],
    ['Loading commands', Promise],
    ['Registering event listeners', Promise],
    ['Connecting to DynamoDB', Promise],
    ['Authenticating with Discord', Promise],
];

async function runStep(label, work) {
    try {
        if (work && typeof work.then === 'function') {
            await work;
        }
        w(`✓ ${label}\n`);
    } catch (err) {
        w(`✗ ${label}\n`);
        throw err;
    }
}

function askLine(prompt) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(prompt, answer => {
            rl.close();
            resolve(answer);
        });
    });
}

async function pickStep({ label, prompt, choices, preset, onPick }) {
    let chosen = preset
        ? choices.find(choice => choice.value === preset)
        : null;

    if (!chosen && process.stdin.isTTY) {
        w(`${label}${prompt && prompt !== label ? ` - ${prompt}` : ''}\n`);
        choices.forEach((choice, index) => {
            w(`  ${index + 1}. ${choice.label}\n`);
        });

        const answer = (await askLine(`Choose [1-${choices.length}]: `)).trim();
        const index = Number(answer) - 1;
        chosen = choices[index] || choices[0];
    }

    if (!chosen) {
        chosen = choices[0];
    }

    if (onPick) onPick(chosen.value);
    w(`✓ ${label}: ${chosen.label}\n`);
}

async function showBanner(version = null, steps = DEFAULT_STEPS) {
    w(`OptiDesk${version ? ` ${version}` : ''} starting...\n`);

    for (const step of steps) {
        if (!Array.isArray(step) && step.kind === 'pick') {
            await pickStep(step);
            continue;
        }

        const [label, work] = step;
        await runStep(label, typeof work === 'function' ? work() : work);
    }
}

module.exports = { showBanner, isTTY };
