// @flow

const WebWorkify = require('webworkify');
const window = require('../window');

import type {WorkerInterface} from '../web_worker';

module.exports = function (): WorkerInterface {
    return (new window.Worker("mapbox-worker.build.js"): any);
};
