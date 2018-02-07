// @flow

const Worker = require('../../source/worker');
const window = require('../window');

import type {WorkerInterface} from '../web_worker';

module.exports = function (): WorkerInterface {
    return (new Worker(): any); // TODO: need to support version number when not in dev mode
};
