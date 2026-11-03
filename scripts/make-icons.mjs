import sharp from 'sharp';
import { readFileSync } from 'node:fs';
const svg = readFileSync('public/icons/icon.svg');
const maskable = Buffer.from(svg.toString().replace('rx="112"', 'rx="0"'));
await sharp(svg).resize(192, 192).png().toFile('public/icons/icon-192.png');
await sharp(svg).resize(512, 512).png().toFile('public/icons/icon-512.png');
await sharp(maskable).resize(512, 512).png().toFile('public/icons/icon-maskable-512.png');
await sharp(maskable).resize(180, 180).png().toFile('public/icons/apple-touch-icon.png');
console.log('icons ok');
