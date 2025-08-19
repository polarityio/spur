'use strict';

const request = require('postman-request');
const async = require('async');
const Address4 = require('ip-address').Address4;

let Logger;
let requestWithDefaults;

const MAX_PARALLEL_LOOKUPS = 10;

function startup(logger) {
  let defaults = {
    json: true
  };

  Logger = logger;

  requestWithDefaults = request.defaults(defaults);
}

function doLookup(entities, options, cb) {
  let lookupResults = [];
  let tasks = [];

  Logger.trace({ entities }, 'doLookup');

  const ignoreIps = options.ignoreIps
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e !== '');

  entities.forEach((entity) => {
    if (!isValidIpv4(entity)) {
      lookupResults.push({
        entity: entity,
        data: null
      });
      return;
    }

    if (isIgnoredIp(entity, ignoreIps)) {
      lookupResults.push({
        entity: entity,
        data: null
      });
      return;
    }

    let requestOptions = {
      method: 'GET',
      uri: `https://api.spur.us/v2/context/${entity.value}`,
      headers: {
        token: options.apiKey
      }
    };

    Logger.trace({ requestOptions }, 'Request Options');

    tasks.push(function (done) {
      requestWithDefaults(requestOptions, function (error, res, body) {
        Logger.trace({ body, status: res ? res.statusCode : 'N/A' }, 'Request Response');
        let processedResult = handleRestError(error, entity, res, body);

        if (processedResult.error) {
          done(processedResult);
          return;
        }

        done(null, processedResult);
      });
    });
  });

  async.parallelLimit(tasks, MAX_PARALLEL_LOOKUPS, (err, results) => {
    if (err) {
      Logger.error({ err: err }, 'Error');
      cb(err);
      return;
    }

    results.forEach((result) => {
      if (result.body === null || result.body.length === 0) {
        lookupResults.push({
          entity: result.entity,
          data: null
        });
      } else {
        lookupResults.push({
          entity: result.entity,
          data: {
            summary: getSummaryTags(result.body),
            details: result.body
          }
        });
      }
    });

    Logger.debug({ lookupResults }, 'Results');
    cb(null, lookupResults);
  });
}

function getSummaryTags(body) {
  const tags = [];

  if (body.as && body.as.organization) {
    tags.push(`Org: ${body.as.organization}`);
  }

  if (body.location && body.location.country) {
    tags.push(`Country: ${body.location.country}`);
  }

  if (Array.isArray(body.services) && body.services.length > 0) {
    tags.push(body.services.map((service) => service.toLowerCase()).join(', '));
  }

  if (Array.isArray(body.risks) && body.risks.length > 0) {
    tags.push(body.risks.map((risk) => risk.toLowerCase()).join(', '));
  }

  return tags;
}

function handleRestError(error, entity, res, body) {
  let result;

  if (error) {
    return {
      error: error,
      detail: 'HTTP Request Error'
    };
  }

  if (res.statusCode === 200 && body) {
    // we got data!
    result = {
      entity: entity,
      body: body
    };
  } else if (res.statusCode === 400) {
    result = {
      error: 'Specified IP is Private',
      detail: body.query_status
    };
  } else if (res.statusCode === 403) {
    result = {
      error: 'Invalid Token Supplied',
      detail: body.query_status
    };
  } else if (res.statusCode === 404) {
    result = {
      error: 'IP address Not Found',
      detail: body.query_status
    };
  } else if (res.statusCode === 429) {
    result = {
      error: 'Out of Credits',
      detail: body.query_status
    };
  } else {
    result = {
      error: 'Unexpected Error',
      statusCode: res ? res.statusCode : 'Unknown',
      detail: 'An unexpected error occurred'
    };
  }

  return result;
}

const isLoopBackIp = (entity) => {
  return entity.startsWith('127');
};

const isLinkLocalAddress = (entity) => {
  return entity.startsWith('169');
};

const isPrivateIP = (entity) => {
  return entity.isPrivateIP === true;
};

const isValidIpv4 = (entity) => {
  return !(isLoopBackIp(entity.value) || isLinkLocalAddress(entity.value) || isPrivateIP(entity));
};

const isIgnoredIp = (entity, ignoreIps) => {
  return ignoreIps.some((ignoreIp) => {
    const ignoreAddress = new Address4(ignoreIp);
    const lookupAddress = new Address4(entity.value);
    if (lookupAddress.isInSubnet(ignoreAddress)) {
      Logger.trace({ ignoreIp: entity.value }, 'Ignoring IP Address due to Ignore IPs filter');
      return true;
    }
    return false;
  });
};

function validateOption(errors, options, optionName, errMessage) {
  if (
    typeof options[optionName].value !== 'string' ||
    (typeof options[optionName].value === 'string' && options[optionName].value.length === 0)
  ) {
    errors.push({
      key: optionName,
      message: errMessage
    });
  }
}

function validateOptions(options, callback) {
  let errors = [];

  validateOption(errors, options, 'apiKey', 'You must provide a valid API Key.');

  if (typeof options.ignoreIps.value === 'string' && options.ignoreIps.value.trim().length > 0) {
    const ignoreIps = options.ignoreIps.value.split(',').map((e) => e.trim());
    const invalidIps = [];
    ignoreIps.forEach((ignoreIp) => {
      if (!Address4.isValid(ignoreIp)) {
        invalidIps.push(ignoreIp);
      }
    });
    if (invalidIps.length > 0) {
      errors.push({
        key: 'ignoreIps',
        message: `Invalid IP or CIDR range provided: ${invalidIps.join(', ')}`
      });
    }
  }

  callback(null, errors);
}

module.exports = {
  doLookup: doLookup,
  validateOptions: validateOptions,
  startup: startup
};
