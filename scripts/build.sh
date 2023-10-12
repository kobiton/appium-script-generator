#!/bin/bash

set -x
rm -rf ./build || true
mkdir ./build

yarn install --frozen-lockfile --dev

# Ignores transpiling templates folder. Just copy it to build folder.
yarn babel src -d build --copy-files --include-dotfiles --ignore 'src/templates'

# Start copy component to build folder.
cp -r ./scripts build/
cp package.json yarn.lock build/
