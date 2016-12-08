"use strict";

const AWS = require("aws-sdk");
const moment = require("moment");
const uuid = require("node-uuid");
const config = require("./components").config;

// S3 Bucket Factory
class S3Bucket {
    constructor(S3, bucketName) {
        this.S3 = S3;
        this.bucketName = bucketName;
    }

    generateKey() {
        let m = moment();
        return `${m.year()}-${m.week()}/${uuid.v4()}`;
    }

    getDownloadURL(signedUrl) {
        return signedUrl.split("?", 2)[0];
    }

    getUploadURL(key, contentType) {
        let params = {
            Bucket: this.bucketName,
            Key: key,
            Expires: 900, // 15 min
            ContentType: contentType,
            ServerSideEncryption: "AES256",
            ACL: "public-read"
        };
        return new Promise((resolve, reject) =>
            this.S3.getSignedUrl("putObject", params, (err, url) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(url);
                }
            })
        );
    }

    putObject(key, mimeType, buffer, callback) {
        let params = {
            Bucket: this.bucketName,
            Key: key,
            Body: buffer,
            ContentType: mimeType,
            ServerSideEncryption: "AES256",
            ACL: "public-read"
        };
        this.S3.putObject(params, callback);
    }

    deleteObject(bucket, key, callback) {
        let params = {
            Bucket: bucket,
            Key: key
        };
        this.S3.deleteObject(params, callback);
    }
}
module.exports.S3Bucket = S3Bucket;

module.exports.newS3Bucket = function(endpoint) {
    let S3 = new AWS.S3();
    if (endpoint) {
        var ep = new AWS.Endpoint(endpoint);
        S3 = new AWS.S3({
            endpoint: ep,
            accessKeyId: "test",
            secretAccessKey: "test"
        });
    }

    let bucket = new S3Bucket(S3, config.s3_bucket);
    return bucket;
};
