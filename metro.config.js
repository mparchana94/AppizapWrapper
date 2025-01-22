// const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// const defaultConfig = getDefaultConfig(__dirname);

// module.exports = mergeConfig(defaultConfig, {
//   resolver: {
//     assetExts: [
//       ...defaultConfig.resolver.assetExts,
//       'html', 'htm', 'txt', 'json', 'js' // Add any other extensions you need
//     ],
//   },
// });


const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);



