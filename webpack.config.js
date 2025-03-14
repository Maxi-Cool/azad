/* Copyright(c) 2018-2021 Philip Mulcahy. */

const webpack = require("webpack");
const path = require("path");
const env = require("./utils/env");
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const CopyWebpackPlugin = require("copy-webpack-plugin");
const imageFileExtensions = ["jpg", "jpeg", "png", "gif", "svg"];

const chrome_extension_options = {
    optimization: {
        usedExports: true,  // Remove unused exports
        minimize: false,     // Minify output
    },
    devtool: "cheap-source-map",
    watchOptions: {
        ignored: /node_modules/,
        aggregateTimeout: 300, // Delay rebuild after first change (ms)
        poll: 1000, // Check for changes every 1000ms (1 sec)
      },
    stats: "verbose",
    target: 'web',
    mode: process.env.NODE_ENV || "development",
    entry: {
        inject: path.join(__dirname, "src", "js", "inject.ts"),
        background: path.join(__dirname, "src", "js", "background.ts"),
        control: path.join(__dirname, "src", "js", "control.ts"),
        alltests: path.join(__dirname, "src", "tests", "all.ts"),
    },
    output: {
        path: path.join(__dirname, "build"),
        filename: "[name].bundle.js",
        charset: true
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'ts-loader',
                        options: {compilerOptions: {outDir: "./build"}},
                    }
                ],
            },
            {
                test: /\.css$/,
                use: ['style-loader','css-loader']
            },
            {
                test: new RegExp('\\.(' + imageFileExtensions.join('|') + ')$'),
                type: 'asset/resource',
                exclude: /node_modules/,
            },
            {
                test: /\.html$/,
                use: ['html-loader'],
                exclude: /node_modules/,
            }
        ]
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
        fallback: {
            "http": require.resolve("stream-http"),
            "https": require.resolve("https-browserify"),
            "url": require.resolve("url/"),
            "assert": require.resolve("assert/"),
            "crypto": require.resolve("crypto-browserify"),
            "stream": require.resolve("stream-browserify"),
            "zlib": require.resolve("browserify-zlib"),
            "os": require.resolve("os-browserify/browser"),
            "path": require.resolve("path-browserify"),
            "buffer": require.resolve("buffer/"),
            "util": require.resolve("util/"),
            "fs": false,
            "tls": false,
            "net": false,
            "child_process": false,
            "perf_hooks": false, // Prevents Webpack from bundling perf_hooks
            "canvas": false,  // Prevents Webpack from trying to bundle `canvas`

            "vm": require.resolve("vm-browserify"),   // Fixes 'vm' error
            "bufferutil": false,                      // Prevents WebSocket optional dependency error
            "utf-8-validate": false 
        }
    },
    plugins: [
        new CleanWebpackPlugin(),
        new webpack.IgnorePlugin({
            resourceRegExp: /^canvas$/
        }),
        new webpack.EnvironmentPlugin({ NODE_ENV: process.env.NODE_ENV || "development" }),
        new webpack.IgnorePlugin({ resourceRegExp: /^\.\/locale$/, contextRegExp: /moment$/ }),
        new webpack.ProvidePlugin({
            process: "process/browser",
            Buffer: ["buffer", "Buffer"],
        }),
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: "src/manifest.json",
                    transform: function (content, _path) {
                        return Buffer.from(
                            JSON.stringify({
                                description: process.env.npm_package_description,
                                version: process.env.npm_package_version,
                                ...JSON.parse(content.toString())
                            })
                        );
                    }
                },
                { from: "node_modules/datatables/media/css/jquery.dataTables.min.css" },
                { from: "src/html/popup.html" },
                { from: "src/img/icon128.png" },
                { from: "src/img/icon48.png" },
                { from: "src/img/sort_asc.png" },
                { from: "src/img/sort_both.png" },
                { from: "src/img/sort_desc.png" },
                { from: "src/styles/datatables_override.css" },
                { from: "src/styles/inject.css" },
                { from: "src/styles/popup.css" }
            ]
        }),
        new webpack.IgnorePlugin({
            resourceRegExp: /^canvas$/,
        }),
        new webpack.IgnorePlugin({
            resourceRegExp: /^perf_hooks$/,
        })
    ]
};

const node_options = {
    target: 'node',
    mode: process.env.NODE_ENV || "development",
    entry: {
        nodejs_tests: path.join(__dirname, "src", "tests", "nodejs_tests.ts"),
    },
    output: {
        path: path.join(__dirname, "build-node"),
        filename: "[name].bundle.js",
        charset: true

    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'ts-loader',
                        options: { transpileOnly: true }  // Speeds up build
                    }
                ],
            },
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader'],
                exclude: /node_modules/,
            },
            {
                test: /\.(jpg|jpeg|png|gif|svg)$/,
                type: 'asset/resource',
                exclude: /node_modules/,
            },
            {
                test: /\.html$/,
                use: ['html-loader'],
                exclude: /node_modules/,
            }
        ]
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
    },
    plugins: [
        new CleanWebpackPlugin(),
        new webpack.EnvironmentPlugin({ NODE_ENV: process.env.NODE_ENV || "development" }),
        new webpack.IgnorePlugin({
            resourceRegExp: /^canvas$/
        }),
    ]
};

if (env.NODE_ENV === "development") {
    chrome_extension_options.devtool = "inline-source-map";
    node_options.devtool = "inline-source-map";
}

module.exports = [chrome_extension_options, node_options];
