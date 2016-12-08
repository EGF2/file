"use strict";

const auth = require("commons/auth");
const components = require("./components");

components.init().then(() => {
    const api = require("./api");
    const s3 = require("./s3");
    const resize = require("./resize");

    const config = components.config;
    const clientData = components.clientData;

    const s3Bucket = s3.newS3Bucket();
    const controller = new api.Controller(clientData, s3Bucket);
    resize.listen(clientData, s3Bucket, config);

    new api.App(auth.handler(config.auth), controller).listen(config.port);
}).catch(err => {
    console.log(err);
    process.exit(1);
});
