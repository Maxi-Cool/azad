const webpack = require("webpack");
const config = require("../webpack.config.js");

const args = process.argv.slice(2);
const isWatchMode = args.includes("--watch");

const compiler = webpack(config);

if (isWatchMode) {
    compiler.watch({
        ignored: /node_modules/,
        aggregateTimeout: 300,
        poll: 1000,
    }, (err, stats) => {
        if (err || stats.hasErrors()) {
            console.error(err || stats.toJson().errors);
        }
        console.log(stats.toString());
    });
} else {
    compiler.run((err, stats) => {
        if (err || stats.hasErrors()) {
            console.error(err || stats.toJson().errors);
        }
        console.log(stats.toString());
    });
}
