"use strict";

/* eslint camelcase: 0 */
/* eslint max-nested-callbacks: ["error", 7] */

const assert = require("assert");
const request = require("supertest");
const agent = require("superagent");
const gm = require("gm");
const auth = require("commons/auth");
let components;
let resize;
let s3;
let api;
let config;
let clientData;
let s3Bucket;
let controller;
let server;

function mockAuthHandler(req, res, next) {
    try {
        let token = auth.getToken(req);
        req.session = {
            token: token,
            user: "00000000-0000-1000-8000-000000000000-03"
        };
        next();
    } catch (err) {
        next(err);
    }
}

describe("File server", () => {
    before(done => {
        require("../components").init().then(() => {
            components = require("../components");
            resize = require("../resize");
            s3 = require("../s3");
            api = require("../api");
            config = components.config;
            clientData = components.clientData;

            s3Bucket = s3.newS3Bucket("http://127.0.0.1:4444");
            controller = new api.Controller(clientData, s3Bucket);
            resize.listen(clientData, s3Bucket, config);
            server = new api.App(mockAuthHandler, controller).server;

            done();
        }).catch(done);
    });

    describe("Image", () => {
        let uploadURL;
        let fileId;
        it("should add new record to db", done => {
            request(server)
                .get("/v1/new_image")
                .query({
                    token: "test_token",
                    mime_type: "image/jpeg",
                    title: "Test image"
                })
                .expect(200)
                .end((err, res) => {
                    if (err) {
                        return done(err);
                    }
                    uploadURL = res.body.upload_url;
                    fileId = res.body.id;
                    assert.ok(fileId);
                    done();
                });
        });

        it("should return upload url to S3", done => {
            assert.ok(uploadURL);
            gm(500, 120, "#00ff55aa")
                .fontSize(68)
                .drawText(20, 72, "TEST IMAGE")
                .toBuffer("jpg", (err, buffer) => {
                    if (err) {
                        return done(err);
                    }
                    agent.put(uploadURL)
                        .type("image/jpeg")
                        .send(buffer)
                        .end(err => {
                            if (err) {
                                return done(err);
                            }
                            clientData.updateObject(fileId, {uploaded: true}).then(() => done())
                                .catch(err => done(err));
                        });
                });
        });
    });

    describe("Avatar", () => {
        let uploadURL;
        let fileId;
        it("should add new record to db", done => {
            request(server)
                .get("/v1/new_image")
                .query({
                    token: "test_token",
                    mime_type: "image/png",
                    title: "Test avatar",
                    kind: "avatar"
                })
                .expect(200)
                .end((err, res) => {
                    if (err) {
                        return done(err);
                    }
                    uploadURL = res.body.upload_url;
                    fileId = res.body.id;
                    assert.ok(fileId);
                    done();
                });
        });

        it("should return upload url to S3", done => {
            assert.ok(uploadURL);
            gm(120, 150, "#001122aa")
                .fontSize(60)
                .drawText(15, 72, "^_^")
                .toBuffer("png", (err, buffer) => {
                    if (err) {
                        return done(err);
                    }
                    agent.put(uploadURL)
                        .type("image/png")
                        .send(buffer)
                        .end(err => {
                            if (err) {
                                return done(err);
                            }
                            clientData.updateObject(fileId, {uploaded: true}).then(() => done())
                                .catch(err => done(err));
                        });
                });
        });
    });

    describe("File", () => {
        let uploadURL;
        let fileId;
        it("should add new record to db", done => {
            request(server)
                .get("/v1/new_file")
                .query({
                    token: "test_token",
                    mime_type: "text/plain",
                    title: "Test text file"
                })
                .expect(200)
                .end((err, res) => {
                    if (err) {
                        return done(err);
                    }
                    uploadURL = res.body.upload_url;
                    fileId = res.body.id;
                    assert.ok(fileId);
                    done();
                });
        });

        it("should return upload url to S3", done => {
            assert.ok(uploadURL);
            agent.put(uploadURL, "Simple text file")
                .type("text/plain")
                .end(err => {
                    if (err) {
                        return done(err);
                    }
                    clientData.updateObject(fileId, {uploaded: true}).then(() => done())
                                .catch(err => done(err));
                });
        });

        it("should delete file in S3", done => {
            clientData.deleteObject(fileId).then(() => done());
        });
    });

    describe("Standalone files", () => {
        let uploadURL;
        let fileId;
        it("should be created with standalone=true", done => {
            request(server)
                .get("/v1/new_file")
                .query({
                    token: "test_token",
                    mime_type: "text/plain",
                    title: "Standalone file test"
                })
                .expect(200)
                .end((err, res) => {
                    if (err) {
                        return done(err);
                    }
                    uploadURL = res.body.upload_url;
                    fileId = res.body.id;
                    assert.ok(fileId);
                    assert.equal(res.body.standalone, true);
                    done();
                });
        });

        it("should return upload url to S3", done => {
            assert.ok(uploadURL);
            agent.put(uploadURL, "Simple text file")
                .type("text/plain")
                .end(err => {
                    if (err) {
                        return done(err);
                    }
                    clientData.updateObject(fileId, {uploaded: true}).then(() => done())
                        .catch(err => done(err));
                });
        });

        it("should be deleted after one day", done => {
            clientData.getObject(fileId).then(file => {
                let date = new Date();
                date.setDate(date.getDate() - 1);
                return clientData.updateObject(file.id, {standalone: true, created_at: date});
            }).then(file => {
                assert.equal(file.standalone, true);
                resize.checkAndRemoveStandaloneFiles(clientData);
                setTimeout(() => {
                    clientData.getObject(fileId).catch(err => {
                        assert.equal(err.name, "ObjectNotExistsError");
                        done();
                    }).catch(err => done(err));
                }, 500);
            }).catch(err => done(err));
        });
    });
});
