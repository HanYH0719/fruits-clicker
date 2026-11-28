import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const run = promisify(execFile);
const project = new URL('../', import.meta.url);
const dist = new URL('dist/', project);
const scratch = await mkdtemp(path.join(tmpdir(), 'fruit-clicker-'));
const stageDirectory = await mkdtemp(fileURLToPath(new URL('.dist-build-', project)));
const staged = pathToFileURL(stageDirectory + path.sep);
const webpExtension = 'EXT_texture_webp';

async function packModel(filename) {
    const glb = await readFile(new URL(filename, project));
    const jsonLength = glb.readUInt32LE(12);
    assert.equal(glb.toString('ascii', 0, 4), 'glTF');
    assert.equal(glb.toString('ascii', 24 + jsonLength, 28 + jsonLength), 'BIN\0');
    const model = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength));
    const binary = glb.subarray(28 + jsonLength);
    assert.equal(model.buffers.length, 1);

    const inputs = new Map();
    for (const image of model.images) {
        if (image.mimeType !== 'image/png') continue;
        assert.ok(!inputs.has(image.bufferView));
        inputs.set(image.bufferView, image);
    }

    const chunks = [];
    const converted = new Set();
    let offset = 0;
    for (const [index, view] of model.bufferViews.entries()) {
        const start = view.byteOffset ?? 0;
        let bytes = binary.subarray(start, start + view.byteLength);
        const image = inputs.get(index);
        if (image) {
            const input = path.join(scratch, 'texture.png');
            await writeFile(input, bytes);
            const { stdout } = await run('cwebp', ['-quiet', '-lossless', '-exact', '-m', '2', '-o', '-', '--', input], {
                encoding: 'buffer', maxBuffer: 16_000_000,
            });
            if (stdout.length < bytes.length) {
                bytes = stdout;
                image.mimeType = 'image/webp';
                converted.add(image);
            }
        }
        view.byteOffset = offset;
        view.byteLength = bytes.length;
        chunks.push(bytes);
        const padding = (4 - bytes.length % 4) % 4;
        if (padding) chunks.push(Buffer.alloc(padding));
        offset += bytes.length + padding;
    }

    if (converted.size === 0) return glb;
    for (const texture of model.textures) {
        if (!converted.has(model.images[texture.source])) continue;
        texture.extensions ??= {};
        texture.extensions[webpExtension] = { source: texture.source };
        delete texture.source;
    }
    model.extensionsUsed = [...(model.extensionsUsed ?? []), webpExtension];
    model.extensionsRequired = [...(model.extensionsRequired ?? []), webpExtension];
    model.buffers[0].byteLength = offset;

    const json = Buffer.from(JSON.stringify(model));
    const padding = Buffer.alloc((4 - json.length % 4) % 4, 0x20);
    const header = Buffer.alloc(20);
    header.write('glTF');
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(28 + json.length + padding.length + offset, 8);
    header.writeUInt32LE(json.length + padding.length, 12);
    header.write('JSON', 16);
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(offset, 0);
    binHeader.write('BIN', 4);
    return Buffer.concat([header, json, padding, binHeader, ...chunks]);
}

try {
    const source = await readFile(new URL('clicker.html', project), 'utf8');
    const module = source.match(/<script type="module">([\s\S]*?)<\/script>/);
    const standalonePlatform = 'const tossPlatform = null;';
    const importMap = /<script type="importmap">[\s\S]*?<\/script>/;
    assert.ok(module?.[1].includes(standalonePlatform) && importMap.test(source));

    const publicHtml = source
        .replace(importMap, '')
        .replace(module[0], '<script type="module" src="./clicker.js"></script>')
        .replace('user-scalable=no', 'user-scalable=no, viewport-fit=cover')
        .replace(/<!-- debug-code:start -->[\s\S]*?<!-- debug-code:end -->/, '');
    await writeFile(new URL('index.html', staged), publicHtml);

    const testRewardedId = 'ait-ad-test-rewarded-id';
    const rewardedAdIds = {
        box: process.env.TOSS_REWARDED_BOX_ID?.trim() || testRewardedId,
        plusBox: process.env.TOSS_REWARDED_PLUS_BOX_ID?.trim() || testRewardedId,
        fruit: process.env.TOSS_REWARDED_FRUIT_ID?.trim() || testRewardedId,
    };
    const bannerAdId = process.env.TOSS_BANNER_AD_ID?.trim() || 'ait-ad-test-banner-id';
    const game = module[1]
        .replace(standalonePlatform, `const tossPlatform = await initTossPlatform(${JSON.stringify(rewardedAdIds)}, ${JSON.stringify(bannerAdId)});`)
        .replace(/\/\/ debug-handler:start[\s\S]*?\/\/ debug-handler:end/, '');
    await build({
        stdin: {
            contents: "import { initTossPlatform } from './apps-in-toss/platform.js';\n" + game,
            resolveDir: fileURLToPath(project),
            sourcefile: 'clicker.html',
        },
        bundle: true,
        format: 'esm',
        target: ['chrome105', 'safari16'],
        minify: true,
        legalComments: 'linked',
        outfile: fileURLToPath(new URL('clicker.js', staged)),
    });

    const referenced = new Set(
        Array.from((source).matchAll(/\.\/([\w-]+\.(?:glb|png|svg|m4a|woff2))/gi), match => match[1]),
    );
    for (const filename of referenced) {
        const input = new URL(filename, project);
        if (filename.endsWith('.glb')) {
            await writeFile(new URL(filename, staged), await packModel(filename));
        } else {
            await copyFile(input, new URL(filename, staged));
        }
    }

    const files = await readdir(staged);
    const size = (await Promise.all(files.map(async file => (await stat(new URL(file, staged))).size)))
        .reduce((total, bytes) => total + bytes, 0);
    assert.ok(size <= 100_000_000, 'Web bundle exceeds the 100 MB Apps in Toss limit.');
    await rm(dist, { recursive: true, force: true });
    await rename(staged, dist);
    console.log('Web bundle: ' + (size / 1_000_000).toFixed(2) + ' MB uncompressed.');
} finally {
    await rm(scratch, { recursive: true, force: true });
    await rm(staged, { recursive: true, force: true });
}
