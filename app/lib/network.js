import networkRequest from 'request'

import render from './render'
import * as db from '../database'
import * as querystring from './querystring'
import {DEBOUNCE_MILLIS} from './constants'

function buildRequestConfig (request, patch = {}) {
  const config = {
    method: request.method,
    body: request.body,
    headers: {},

    // Setup redirect rules
    followRedirect: true,
    maxRedirects: 10,

    // Unzip gzipped responses
    gzip: true
  };

  // Default the proto if it doesn't exist
  if (request.url.indexOf('://') === -1) {
    config.url = `https://${request.url}`;
  } else {
    config.url = request.url;
  }

  // Set basic auth if we need to
  if (request.authentication.username) {
    config.auth = {
      user: request.authentication.username,
      pass: request.authentication.password
    }
  }

  for (let i = 0; i < request.headers.length; i++) {
    let header = request.headers[i];
    if (header.name) {
      config.headers[header.name] = header.value;
    }
  }

  const qs = querystring.buildFromParams(request.params);
  config.url = querystring.joinURL(request.url, qs);

  return Object.assign(config, patch);
}

function actuallySend (request, callback) {
  // TODO: Handle cookies
  let config = buildRequestConfig(request, {
    jar: networkRequest.jar(),
    followRedirect: true
  }, true);

  const startTime = Date.now();
  networkRequest(config, function (err, response) {
    if (err) {
      db.responseCreate({
        parentId: request._id,
        millis: Date.now() - startTime,
        error: err.toString()
      });
      console.warn(`Request to ${config.url} failed`, err);
    } else {
      db.responseCreate({
        parentId: request._id,
        statusCode: response.statusCode,
        statusMessage: response.statusMessage,
        contentType: response.headers['content-type'],
        url: request.url,
        millis: Date.now() - startTime,
        bytes: response.connection.bytesRead,
        body: response.body,
        headers: Object.keys(response.headers).map(name => {
          const value = response.headers[name];
          return {name, value};
        })
      });
    }

    callback(err);
  });
}

export function send (requestId, callback) {
  // First, lets wait for all debounces to finish
  setTimeout(() => {
    db.requestById(requestId).then(request => {
      db.requestGroupById(request.parentId).then(requestGroup => {
        const environment = requestGroup ? requestGroup.environment : {};

        if (environment) {
          // SNEAKY HACK: Render nested object by converting it to JSON then rendering
          const template = JSON.stringify(request);
          request = JSON.parse(render(template, environment));
        }

        actuallySend(request, callback);
      });
    })
  }, DEBOUNCE_MILLIS);
}