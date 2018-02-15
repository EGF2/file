"use strict";

const option = require("commons/option");
const bunyan = require("bunyan");
const search = require("commons/search");
require("dotenv").config();

function init() {
    return option().config.then(config => {
        for (let key in config) {
            if (process.env[`egf_${key}`]) {
                try {
                    config[key] = JSON.parse(process.env[`egf_${key}`]);
                } catch (e) {
                    config[key] = process.env[`egf_${key}`];
                }
            }
        }

        const log = bunyan.createLogger({
            name: "file",
            level: config.log_level
        });

        log.info({config});

        module.exports.config = config;
        module.exports.clientData = require("commons/client-data")(config["client-data"]);
        module.exports.searcher = new search.Searcher(config.elastic);
        module.exports.logger = log;
        return module.exports;
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = {
    init
};
