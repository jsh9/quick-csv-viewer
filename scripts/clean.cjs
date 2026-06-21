#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

fs.rmSync(path.join(root, 'out'), { recursive: true, force: true });
