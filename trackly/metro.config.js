const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Add .wasm to assetExts to support expo-sqlite on web
config.resolver.assetExts.push('wasm');

module.exports = config;
