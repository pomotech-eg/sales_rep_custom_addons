module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
        'expo-router/babel',
        'react-native-reanimated/plugin',
        ['module:react-native-dotenv', {
            "moduleName": "@env",
            "path": ".env",
            "blacklist": null,
            "whitelist": null,
            "safe": false,
            "allowUndefined": true
        }],
        // Custom transform for import.meta to prevent web bundle crashes
        {
          visitor: {
            MetaProperty(path) {
              if (path.node.meta.name === 'import' && path.node.property.name === 'meta') {
                path.replaceWith({
                  type: 'ObjectExpression',
                  properties: []
                });
              }
            }
          }
        }
    ],
  };
};
