'use strict';

/**
 * Keep your Lambda functions warm
 * @author Jeremy Daly <jeremy@jeremydaly.com>
 * @version 1.1.0
 * @license MIT
 */

export interface Config {
    flag?: string;
    concurrency?: string;
    test?: string;
    log?: boolean;
    correlationId?: string;
    delay?: number;
}

const id = Date.now().toString() + '-' + ('0000' + Math.floor(Math.random() * 1000).toString()).substr(-4);

let warm = false;
let lastAccess: null | number = null;

const lastAccessedSeconds = () => lastAccess === null ? null : ((Date.now() - lastAccess) / 1000).toFixed(1);

const funcName = process.env.AWS_LAMBDA_FUNCTION_NAME;

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

export const getMetadata = () => ({id, warm, lastAccess, lastAccessedSeconds, funcName});

export const warmer = async (event: any, cfg: Config = {}) => {

    const config = Object.assign({}, {
        flag: 'warmer', // default test flag
        concurrency: 'concurrency', // default concurrency field
        test: 'test', // default test flag
        log: true, // default logging to true
        correlationId: id, // default the correlationId
        delay: 75, // default the delay to 75ms
    }, cfg);

    // If the event is a warmer ping
    if (event && event[config.flag]) {

        const concurrency = event[config.concurrency]
        && !isNaN(event[config.concurrency])
        && event[config.concurrency] > 1
            ? event[config.concurrency] : 1;

        const invokeCount = event.__WARMER_INVOCATION__
        && !isNaN(event.__WARMER_INVOCATION__)
            ? event.__WARMER_INVOCATION__ : 1;

        const invokeTotal = event.__WARMER_CONCURRENCY__
        && !isNaN(event.__WARMER_CONCURRENCY__)
            ? event.__WARMER_CONCURRENCY__ : concurrency;

        const correlationId = event.__WARMER_CORRELATIONID__
            ? event.__WARMER_CORRELATIONID__ : config.correlationId;

        // Create log record
        const log = {
            action: 'warmer',
            function: funcName,
            id,
            correlationId,
            count: invokeCount,
            concurrency: invokeTotal,
            warm,
            lastAccessed: lastAccess,
            lastAccessedSeconds: lastAccessedSeconds(),
        };

        // Log it
        if (config.log) {
            console.log(log);
        }

        // flag as warm
        warm = true;
        lastAccess = Date.now();

        // Fan out if concurrency is set higher than 1
        if (concurrency > 1 && !event[config.test]) {

            // init Lambda service
            const lambda = require('./lib/lambda-service');

            // init promise array
            const invocations = [];

            // loop through concurrency count
            for (let i = 2; i <= concurrency; i++) {

                // Set the params and wait for the final function to finish
                const params = {
                    FunctionName: funcName,
                    InvocationType: i === concurrency ? 'RequestResponse' : 'Event',
                    LogType: 'None',
                    Payload: new Buffer(JSON.stringify({
                        [config.flag]: true, // send warmer flag
                        __WARMER_INVOCATION__: i, // send invocation number
                        __WARMER_CONCURRENCY__: concurrency, // send total concurrency
                        __WARMER_CORRELATIONID__: correlationId, // send correlation id
                    })),
                };

                // Add promise to invocations array
                invocations.push(lambda.invoke(params).promise());

            } // end for

            // Invoke concurrent functions
            await Promise.all(invocations);
            return true;

        } else if (invokeCount > 1) {
            await delay(config.delay);
            return true;
        }

        return true;
    } else {
        warm = true;
        lastAccess = Date.now();
        return false;
    }

}; // end module
