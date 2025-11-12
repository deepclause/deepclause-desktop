#!/usr/bin/env node

const { generateLoadedImageFile, generateImageFile } = require('../generateImage')
const path = require('path');

function getPath(pth) {
  return pth.startsWith('http://') || pth.startsWith('https://')
    ? pth
    : path.join(process.cwd(), pth)
}

async function mainFunc() {
  let args = process.argv.slice(2);

  const fn = process.argv.includes('--image-only') ? generateImageFile : generateLoadedImageFile;
  args = args.filter(elem => elem !== '--image-only');

  if (args.length !== 2) {
    throw new Error('Expected exactly 2 inputs, input prolog (.pl) file and output file');
  }

  await fn(getPath(args[0]), getPath(args[1]));
}

mainFunc();
