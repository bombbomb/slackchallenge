var express = require('express');
var bodyParser  = require('body-parser');

module.exports = class HttpListener {
    constructor(controller) {
        this._controller = controller;
        this._app = express();

        this._app.use(bodyParser.json());
        this._app.use(bodyParser.urlencoded({ extended: true }));

        this._app.get('/health-check', function (request, response) {
            response.send('Ok.');
        });

        this._app.get('/slack-thing', function (request, response) {
            console.log(request);
            response.send('Ok.');
        });

        console.log("I'm listening!");
        this._app.listen(8080);
    }
};