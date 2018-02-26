"use strict";

/* eslint camelcase: 0 */

const restify = require("restify");
const log = require("./components").logger;
const config = require("./components").config;

// HTTP controller
class Controller {
    constructor(clientData, s3Bucket) {
        this.clientData = clientData;
        this.s3Bucket = s3Bucket;
    }

    // Create file
    createFileHandler() {
        return (req, res, next) => {
            try {
                let mimeType = req.query.mime_type;
                let title = req.query.title;
                let size = req.query.size;
                let resizes = [];
                if (req.query.kind) {
                    if (config.kinds[req.query.kind]) {
                        config.kinds[req.query.kind].forEach(dimensions => {
                            let obj = {};
                            obj.dimensions = dimensions;
                            resizes.push(obj);
                        });
                    }
                }
                if (!mimeType) {
                    return next(new restify.errors.BadRequestError("'mime_type' parameter requered"));
                }
                if (resizes && resizes.length > 0 && !mimeType.startsWith("image/")) {
                    return next(new restify.errors.BadRequestError("'mime_type' must be image type"));
                }
                let fileKey = this.s3Bucket.generateKey();
                this.s3Bucket.getUploadURL(fileKey, mimeType).then(uploadURL => {
                    let file = {
                        user: req.session.user,
                        object_type: "file",
                        title: title,
                        mime_type: mimeType,
                        hosted: true,
                        resizes: resizes,
                        url: this.s3Bucket.getDownloadURL(uploadURL),
                        size: size,
                        standalone: true
                    };

                    return this.clientData.createObject(file).then(file => {
                        file.upload_url = uploadURL; // don't save upload URL to DB
                        return file;
                    }).then(file => res.send(file));
                }).catch(err => {
                    log.error(err);
                    next(err);
                });
            } catch (err) {
                log.error(err);
                next(err);
            }
        };
    }
}
module.exports.Controller = Controller;

// File server with routing
class App {
    constructor(authHandler, controller) {
        let server = restify.createServer({
            name: "file"
        });
        server.use(restify.queryParser());

        // healthcheck
        server.get("/healthcheck", (req, res) => res.send(200));

        server.use(authHandler);

        // create image
        server.get("/v1/new_image", controller.createFileHandler());

        // create simple file
        server.get("/v1/new_file", controller.createFileHandler());
        this.server = server;
    }

    listen(port) {
        let server = this.server;
        this.server.listen(port, function() {
            log.info({url: server.url}, "File server started...");
        });
    }
}
module.exports.App = App;
