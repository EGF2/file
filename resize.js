"use strict";

/* eslint camelcase: 0 */
/* eslint max-nested-callbacks: ["error", 5] */

const gm = require("gm").subClass({imageMagick: true});
const request = require("request");
const log = require("./components").logger;
const eventConsumer = require("commons/event-consumer");
const searcher = require("./components").searcher;

// NOTE: need run only one resize listener

// Resize images
function resizeImage(clientData, s3Bucket, doc) {
    // resize only if need
    if (doc.resizes.every(resize => "url" in resize)) {
        return Promise.resolve();
    }
    // get original image
    let image = new Promise((resolve, reject) => {
        gm(request(doc.url)).toBuffer((err, buffer) => {
            if (err) {
                reject(err);
            } else {
                resolve(buffer);
            }
        });
    });
    image.then(origin => { // resize images and save to db
        let resizes = doc.resizes.map(resize => {
            let d = resize.dimensions;
            if (resize.url) {
                return resize; // no need to resize
            }
            let key = s3Bucket.generateKey();
            return s3Bucket.getUploadURL(key, doc.mime_type).then(uploadUrl =>
                new Promise((resolve, reject) => {
                    gm(origin)
                        .resize(d.width, d.height)
                        .gravity("Center")
                        .crop(d.width, d.height)
                        .toBuffer((err, buffer) => {
                            if (err) {
                                return reject(err);
                            }

                            resize.url = s3Bucket.getDownloadURL(uploadUrl);
                            s3Bucket.putObject(key, doc.mime_type, buffer, err => {
                                if (err) {
                                    return reject(err);
                                }
                                resolve(resize); // return resize with url
                            });
                        });
                })
            );
        });
        return Promise.all(resizes).then(resizes => { // take resizes array and update DB
            return new Promise((resolve, reject) => {
                gm(origin).size((err, dimensions) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve({
                        id: doc.id,
                        dimensions: dimensions, // set origin dimensions
                        resizes: resizes // set resizes
                    });
                });
            }).then(doc => clientData.updateObject(doc.id, {dimensions: doc.dimensions, resizes: doc.resizes}));
        }).then(doc => log.info({file_id: doc.id}, "File resized"));
    }).catch(err => log.error(err));
}

// Delete all files from document
function deleteFiles(doc, s3Bucket) {
    let urls = [doc.url];
    try {
        urls = urls.concat(doc.resizes.map(doc => doc.url));
    } catch (err) {
    }
    urls.forEach(url => {
        try {
            let path = url.split("/");
            let bucket = path[path.length - 3];
            if (path.indexOf(".s3.amazonaws.com") > -1) {
                bucket.replace(".s3.amazonaws.com", "");
            }
            let key = path.slice(-2).join("/");
            s3Bucket.deleteObject(bucket, key, err => {
                if (err) {
                    log.error(err);
                } else {
                    log.info({s3: {bucket, key}}, "File deleted");
                }
            });
        } catch (err) {
            log.error(err);
        }
    });
}

// Check if event.edge.dst or event.body have files ids
// In such case File.standalone will be set to false
function checkFileReference(clientData, event) {
    let filesIds = [];
    let promises = [];
    if (event.current.edge) { // check event.edge.dst is file id
        promises.push(clientData.getObjectType(event.current.edge.dst).then(type => {
            if (type === "file") {
                filesIds.push(event.current.edge.dst);
            }
        }));
    } else { // check files ids in body
        let extractFromObject = obj => {
            Object.keys(obj).forEach(key => {
                try {
                    let val = obj[key];
                    if (typeof val === "object") {
                        extractFromObject(val);
                    } else {
                        promises.push(clientData.getObjectType(val).then(type => {
                            if (type === "file") {
                                filesIds.push(val);
                            }
                        }));
                    }
                } catch (err) {
                    log.error(err);
                }
            });
        };
        extractFromObject(event.current);
    }
    Promise.all(promises).then(() => {
        if (filesIds.length) { // set standalone = false
            filesIds.map(fileId =>
                clientData.getObject(fileId).then(file =>
                    clientData.updateObject(file.id, {standalone: false})));
        }
    });
}

// Listen changes
function listen(clientData, s3Bucket, config) {
    setInterval(checkAndRemoveStandaloneFiles, 1000 * 60 * 60 * 24, clientData);
    eventConsumer(config, event =>
        new Promise(resolve => {
            try {
                var object_type = event.current ? event.current.object_type : event.previous.object_type;
                if (event.object && object_type === "file") { // check file action
                    if (event.method === "PUT") {
                        let file = event.current;
                        if (file.uploaded === true && "resizes" in file) {
                            resizeImage(clientData, s3Bucket, file);
                        }
                    } else if (event.method === "DELETE") {
                        deleteFiles(event.previous, s3Bucket);
                    }
                } else if (event.method === "POST" || event.method === "PUT") { // check file reference
                    checkFileReference(clientData, event);
                }
            } catch (err) {
                log.error(err);
            }
            resolve();
        }), err => log.error(err)
    );
}

module.exports.listen = listen;

function checkAndRemoveStandaloneFiles(clientData) {
    log.info("Check and remove standalone files");
    let yesterday = new Date().setDate(new Date() - 1);

    clientData.forEachPage(
        last => searcher.search({object: "file", filters: {standalone: "true"},
            range: {created_at: {lte: yesterday}}, count: 100, after: last}),
        found => Promise.all(found.results.map(fileId => clientData.deleteObject(fileId)))
    );
}
module.exports.checkAndRemoveStandaloneFiles = checkAndRemoveStandaloneFiles;
