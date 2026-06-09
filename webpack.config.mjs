import path from "path";
import { fileURLToPath } from "url";
import CopyWebpackPlugin from "copy-webpack-plugin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const svgdomDefaultsPath = path.resolve(__dirname, "node_modules/svgdom/src/utils/defaults.js");

export default {
  mode: "production",
  target: "node16",
  entry: path.resolve(__dirname, "plugin/app.js"),
  experiments: {
    outputModule: true,
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "app.js",
    module: true,
    library: {
      type: "module",
    },
    chunkFormat: "module",
    clean: true,
  },
  module: {
    rules: [
      {
        test: svgdomDefaultsPath,
        use: [
          {
            loader: "string-replace-loader",
            options: {
              multiple: [
                {
                  search: /__dirname\s*=\s*[^\)]+\)/,
                  replace: " __dirname = dirname(process.argv[1]",
                },
                {
                  search: /fontDir\s*=\s*[^\)]+\)/,
                  replace: " fontDir = join(__dirname, 'fonts/')",
                },
              ],
            },
          },
        ],
      },
    ],
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        {
          from: "node_modules/svgdom/fonts/OpenSans-Regular.ttf",
          to: "fonts/",
        },
      ],
    }),
  ],
  resolve: {
    fallback: {
      "supports-color": false,
    },
  },
  optimization: {
    minimize: true,
  },
  stats: "minimal",
};
