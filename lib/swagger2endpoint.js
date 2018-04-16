var async = require('async'); // Asynchronous operations
var bunyan = require('bunyan'); // Logging
var fs = require('fs'); // File system
//var http = require('follow-redirects').http; // HTTP client
//var https = require('follow-redirects').https; // Secure HTTP client
var path = require('path'); // Directory
var mashery = require('mashery-client'); // V3 API
var swagger = require('swagger-parser'); // Swagger validator
var url = require('url'); // URL parser
var delay = require('delay');

var description = 'swagger2endpoint';
var log = bunyan.createLogger({
    name: description,
    serializers: {
        req: bunyan.stdSerializers.req,
        res: bunyan.stdSerializers.res,
        err: bunyan.stdSerializers.err
    },
    level: bunyan.DEBUG
});

var creds = require(path.join(__dirname, '..', 'credentials.js'));

var errorCode;
var errorMsg;
var warnMsg;

function swagger2endpoint(options) {
	var promise = new Promise((resolve, reject) => {
		/*****************************
		 * initialize the API client *
		 *****************************/
		var apiClient = mashery.init({
			user: mashery_user_id,
			pass: mashery_password,
			key: mashery_api_key,
			secret: mashery_api_key_secret,
			areaUuid: mashery_area_uuids[0].uuid
		});

		var trafficManagerHost = mashery_area_uuids[0].tm_host;
		var controlCenterUrl = mashery_area_uuids[0].cc_url;

		var printOnly = options.print_only ? true : false;
		var validateSwagger = options.validate_swagger ? true : false;
		
		/*******************************
		 * Load the Swagger definition *
		 *******************************/
		var swaggerDoc;
		var apiName;
		var apiId;
		var swaggerDir = '';

		
		var domains = [];
		var endpoints = [];
		var endpointUrls = [];

		/**************************
		 * check domain whitelist *
		 **************************/
		var whitelist = [];
		var whitelistDomain = function(dmArgs) {
			if (whitelist.indexOf(dmArgs.data.domain) < 0) {
				delay(1000).then(() => {
					log.debug("  Creating domain : " + dmArgs.data.domain);
					apiClient.methods.createDomain(dmArgs, function(domainData, domainRawResponse) {
						log.debug(domainData);
						if (domainData && domainData.errorCode && domainData.errorCode === 400 &&
							domainData.errors && domainData.errors.length > 0) {
							if (domainData.errors[0].message && domainData.errors[0].message.indexOf("duplicate value") > 0) {
								if (whitelist.indexOf(dmArgs.data.domain) < 0) {
									log.error(domainData);
									warnMsg = "Domain '" + dmArgs.data.domain + "' is already whitelisted";
								}
							} else {
								log.error(domainData);
								errorMsg = domainData.errorMessage ? domainData.errorMessage :
									(domainData.errors && domainData.errors.length > 0 ? domainData.errors[0].message : "UNKNOWN");
							}
						} else {
							log.info("Registering new domain: '%s' is now %s", domainData.domain, domainData.status);
							if (domainData && domainData.status === "active" && whitelist.indexOf(domainData.domain) < 0) {
								whitelist.push(domainData.domain);
							}
						}
					});
				});
			}
		};

		/*************************
		 * create a new endpoint *
		 *************************/
		var createEndpoint = function(epArgs, callback) {
			log.debug("Creating endpoint %s %s", epArgs.data.name, JSON.stringify(epArgs));
			delay(1000).then(() => {
				apiClient.methods.createServiceEndpoint(epArgs, function(epData, epRawResponse) {
					log.debug(epData);
					if (epData.errorCode && epData.errorCode === 400 &&
						epData.errors && epData.errors.length > 0) {
						errorMsg = epData.errorMessage + " " + (epData.errors[0].message ? epData.errors[0].message : "");
						log.error(epData);
						callback(new Error(epData));
					} else if (epData.errorCode && epData.errorCode === 500) {
						errorMsg = JSON.stringify(epData);
						log.error(epData);
						callback(new Error(epData));
					} else {
						if ("undefined" === typeof epData.name) {
							errorMsg = JSON.stringify(epData);
							log.error(epData);
							callback(new Error(epData));
						} else {
							endpointUrls.push(epData.name);
							log.debug("Endpoint " + epData.name + " was created");
							callback();
						}
					}
				});
			});
		};

		/***********************
		 * Render output *
		 ***********************/
		var renderOutput = function() {
			console.log("# of endpoints: %d", endpointUrls.length);
			var wlMulti;
			if (whitelist.length > 1) {
				wlMulti = "true";
			}
			var epMulti;
			if (endpointUrls.length > 1) {
				epMulti = "true";
			}
			
			return JSON.stringify({
				title: 'Swagger2Mashery',
				description: description,
				printOnly: printOnly,
				error: errorMsg,
				warn: warnMsg,
				whitelist: whitelist,
				wlMulti: wlMulti,
				endpoints: endpointUrls,
				epMulti: epMulti,
				apiName: apiName,
				apiId: apiId,
				ccUrl: controlCenterUrl,
				tgtUuid: mashery_area_uuids[0].uuid,
				tgtUuids: mashery_area_uuids
			});
		};
		
		/***********************
		 * Process Swagger 1.2 *
		 ***********************/
		var processSwagger12 = function(resolve, reject, swaggerDoc, apiId, basePath) {
			// create new endpoint(s)
			var epArgs;
			var httpMethods = [];
			var methods = [];
			var ep;
			var cleanPath = '';

			for (ep = 0; ep < swaggerDoc.apis.length; ep++) {
				var api = swaggerDoc.apis[ep];

				// supported HTTP verbs and methods
				httpMethods = [];
				methods = [];

				for (var op = 0; op < api.operations.length; op++) {
					if ("undefined" !== typeof api.operations[op].method &&
						api.operations[op].method) {
						httpMethods.push(api.operations[op].method.toLowerCase());
					} else {
						// BW6-generated sample had an invalid property named "httpMethod" instead of "method"
						httpMethods.push(api.operations[op].httpMethod.toLowerCase());
					}
					if ("undefined" !== typeof api.operations[op].nickname &&
						isNaN(parseInt(api.operations[op].nickname))) { // this is to avoid auto-generated numeric nicknames
						methods.push({ "name": api.operations[op].nickname });
					}
				} // end for op in api.operations

				// endpoint metadata
				cleanPath = (api.path.indexOf('/') === 0 ? api.path.substring(1) : api.path)
					.replace(/{([A-Za-z0-9_]+)}/g, /$1/)
					.replace(/\//g, ' ')
					.replace(/\s\s/g, ' ')
					.replace(/_/g, ' ').trim();

				var queryParam = cleanPath.indexOf('?');
				if (queryParam > 0) {
					cleanPath = cleanPath.substring(0, queryParam);
				}

				if (methods.length === 0) {
					methods.push({ "name": cleanPath });
				}

				// check if target domain is whitelisted
				var dmArgs = {
					data: {
						"domain": basePath.hostname,
						"status": "active"
					}
				};

				if (printOnly) {
					if (whitelist.indexOf(dmArgs.data.domain) < 0) {
						whitelist.push(dmArgs.data.domain);
					}
				} else {
					domains.push(dmArgs);
				}

				/******************
				 * Update methods *
				 ******************/
				for (var m = 0; m < methods.length; m++) {
/*					var jsonFile = swaggerDir + path.sep + methods[m].name + ".json";
					var xmlFile = swaggerDir + path.sep + methods[m].name + ".xml";

					var updateJson = fs.existsSync(jsonFile);
					var updateXml = fs.existsSync(xmlFile);

					if (updateJson || updateXml) {
						var mdArgs = {
							name: methods[m].name,
							sampleJsonResponse: "{}",
							sampleXmlResponse: "<null/>"
						};
						if (updateJson) {
							mdArgs.sampleJsonResponse = fs.readFileSync(jsonFile, 'utf-8');
						}
						if (updateXml) {
							mdArgs.sampleXmlResponse = fs.readFileSync(xmlFile, 'utf-8');
						}
						methods[m] = mdArgs;
					} // end if updateJson || updateXml
					*/
				} // end for methods

				if (!printOnly) {
					epArgs = {
						path: { serviceId: apiId },
						data: {
							"name": cleanPath,
							"outboundRequestTargetPath": api.path.indexOf("/") >= 0 ? api.path.substring(1) : api.path,
							"outboundTransportProtocol": basePath.protocol === 'https:' ? 'https' : 'http',
							"supportedHttpMethods": httpMethods,
							"methods": methods,
							"publicDomains": [{
								"address": trafficManagerHost
							}],
							"requestPathAlias": api.path.indexOf("/") >= 0 ? api.path.substring(1) : api.path,
							"systemDomains": [{
								"address": basePath.host
							}],
							"inboundSslRequired": false
						}
					};
					endpoints.push(epArgs);
				} else {
					endpointUrls.push(cleanPath);
				}
				ep++;
			} // end for swaggerDoc.apis

			async.eachSeries(domains, whitelistDomain, function(err) {
				if (err) { reject(err); }
			});
			async.eachSeries(endpoints, createEndpoint, function(err) {
				if (err) { reject(err); }
				renderOutput();
			});
			
			resolve("OK");
		};

		/***********************
		 * Process Swagger 2.0 *
		 ***********************/
		var processSwagger20 = function(resolve, reject, swaggerDoc, apiId, basePath) {
			log.debug("Inside processSwagger20");
			var epArgs;
			var httpMethods = [];
			var methods = [];
			var ep;
			var cleanPath = '';

			// Swagger 2.0 validation - optional as BW6.2 generates Swagger 1.2 definitions, and BW6.3 generates Swagger 2.0
			var swaggerVer = swaggerDoc.swagger ? swaggerDoc.swagger : swaggerDoc.swaggerVersion;
			if (swaggerVer === "2.0" && validateSwagger) {
				swagger.validate(swaggerDoc, function(err, api) {
					if (err && err.message) {
						errorMsg = "Swagger 2.0 validation error: " + JSON.stringify(err.message, null, 2);
						log.error(errorMsg);
					}
				});
			}

			ep = 0;
			log.debug("# of paths: " + Object.keys(swaggerDoc.paths).length);
			for (var p in swaggerDoc.paths) {
				if (p.length > 0) {
					// supported HTTP verbs and methods
					httpMethods = [];
					methods = [];

					var oPath = swaggerDoc.paths[p];
					log.debug("Path: %s", p);
					var keys = Object.keys(oPath);
					if ("undefined" !== keys && Array.isArray(keys)) {
						for (var key in keys) {
							if (key >= 0) {
								var keyName = keys[key].toString().toLowerCase();
								log.debug("   Key: %s", keyName);
								httpMethods.push(keyName);
							}
						}
					} else if ("object" === keys) {
						httpMethods.push(keys.toString().toLowerCase());
					}

					cleanPath = (p.indexOf('/') === 0 ? p.substring(1) : p)
						.replace(/{([A-Za-z0-9_]+)}/g, /$1/)
						.replace(/\//g, ' ')
						.replace(/{\?[A-Za-z0-9_,]+}/g, "")
						.replace(/\s\s/g, ' ')
						.replace(/_/g, ' ').trim();

					var queryParam = cleanPath.indexOf('?');
					if (queryParam > 0) {
						cleanPath = cleanPath.substring(0, queryParam);
					}
					methods.push({ "name": cleanPath });

					// check if target domain is whitelisted
					console.log('****' + JSON.stringify(basePath));
					console.log('****' + basePath.hostname);
					var dmArgs = {
						data: {
							"domain": basePath.hostname,
							"status": "active"
						}
					};

					log.debug("  Domain: " + dmArgs.data.domain);
					
					if (printOnly) {
						if (whitelist.indexOf(dmArgs.data.domain) < 0) {
							whitelist.push(dmArgs.data.domain);
						}
					} else {
						domains.push(dmArgs);
					}

					/******************
					 * Update methods *
					 ******************/
					for (var m = 0; m < methods.length; m++) {
/*						var mdArgs = {
							name: methods[m].name,
							sampleJsonResponse: "{}",
							sampleXmlResponse: "<null/>"
						};
						var jsonFile = swaggerDir + path.sep + methods[m].name + ".json";
						var xmlFile = swaggerDir + path.sep + methods[m].name + ".xml";

						var updateJson = fs.existsSync(jsonFile);
						var updateXml = fs.existsSync(xmlFile);

						if (updateJson || updateXml) {
							if (updateJson) {
								mdArgs.sampleJsonResponse = fs.readFileSync(jsonFile, 'utf-8');
							}
							if (updateXml) {
								mdArgs.sampleXmlResponse = fs.readFileSync(xmlFile, 'utf-8');
							}
						} // end if updateJson || updateXml

						methods[m] = mdArgs;
						*/
					} // end for methods

					log.debug(JSON.stringify(methods, null, 2));
					epArgs = {
						path: { serviceId: apiId },
						data: {
							"name": cleanPath,
							"outboundRequestTargetPath": (basePath.pathname + p).replace("//", "/").replace(/{\?[A-Za-z0-9_,]+}/g, ""),
							"outboundTransportProtocol": basePath.protocol === 'https:' ? 'https' : 'http',
							"supportedHttpMethods": httpMethods,
							"methods": methods,
							"publicDomains": [{
								"address": trafficManagerHost
							}],
							"requestPathAlias": p.replace(/{\?[A-Za-z0-9_,]+}/g, ""), //(basePath.pathname + p).replace("//", "/"),
							"systemDomains": [{
								"address": basePath.host
							}],
							"inboundSslRequired": false
						}
					};

					if (!printOnly) {
						endpoints.push(epArgs);
					} else {
						endpointUrls.push(epArgs.data.name);
					}
					ep++;
				} // end if p.length > 0
			} // end for p in paths

			async.eachSeries(domains, whitelistDomain, function(err) {
				if (err) { reject(err); }
			});
			async.eachSeries(endpoints, createEndpoint, function(err) {
				if (err) { reject(err); }
				renderOutput();
			});
			
			resolve("OK");
		};

		/***********************
		 * Process Swagger 3.0 *
		 ***********************/
		var processSwagger30 = function(resolve, reject, swaggerDoc, apiId, basePath) {
			log.debug("Inside processSwagger30");
			var epArgs;
			var httpMethods = [];
			var methods = [];
			var ep;
			var cleanPath = '';

			// Swagger 3.0 validation - optional as BW6.2 generates Swagger 1.2 definitions, and BW6.3 generates Swagger 2.0
			var swaggerVer = swaggerDoc.openapi;
			if (swaggerVer === "3.0.0" && validateSwagger) {
				swagger.validate(swaggerDoc, function(err, api) {
					if (err && err.message) {
						errorMsg = "Swagger 3.0 validation error: " + err.message;
						log.error(errorMsg);
					}
				});
			}

			ep = 0;
			log.debug("# of paths: " + Object.keys(swaggerDoc.paths).length);
			for (var p in swaggerDoc.paths) {
				if (p.length > 0) {
					// supported HTTP verbs and methods
					httpMethods = [];
					methods = [];

					var oPath = swaggerDoc.paths[p];
					//console.log("Path: %s", p);
					var keys = Object.keys(oPath);
					if ("undefined" !== keys && Array.isArray(keys)) {
						for (var key in keys) {
							if (key >= 0) {
								var keyName = keys[key].toString().toLowerCase();
								//console.log("   Key: %s", keyName);
								httpMethods.push(keyName);
							}
						}
					} else if ("object" === keys) {
						httpMethods.push(keys.toString().toLowerCase());
					}

					cleanPath = (p.indexOf('/') === 0 ? p.substring(1) : p)
						.replace(/{([A-Za-z0-9_]+)}/g, /$1/)
						.replace(/\//g, ' ')
						.replace(/{\?[A-Za-z0-9_,]+}/g, "")
						.replace(/\s\s/g, ' ')
						.replace(/_/g, ' ').trim();

					var queryParam = cleanPath.indexOf('?');
					if (queryParam > 0) {
						cleanPath = cleanPath.substring(0, queryParam);
					}
					methods.push({ "name": cleanPath });

					// check if target domain is whitelisted
					var dmArgs = {
						data: {
							"domain": basePath.hostname ? basePath.hostname : parsedUrl.hostname,
							"status": "active"
						}
					};

					if (printOnly) {
						if (whitelist.indexOf(dmArgs.data.domain) < 0) {
							whitelist.push(dmArgs.data.domain);
						}
					} else {
						domains.push(dmArgs);
					}

					/******************
					 * Update methods *
					 ******************/
					for (var m = 0; m < methods.length; m++) {
/*						var mdArgs = {
							name: methods[m].name,
							sampleJsonResponse: "{}",
							sampleXmlResponse: "<null/>"
						};
						var jsonFile = swaggerDir + path.sep + methods[m].name + ".json";
						var xmlFile = swaggerDir + path.sep + methods[m].name + ".xml";

						var updateJson = fs.existsSync(jsonFile);
						var updateXml = fs.existsSync(xmlFile);

						if (updateJson || updateXml) {
							if (updateJson) {
								mdArgs.sampleJsonResponse = fs.readFileSync(jsonFile, 'utf-8');
							}
							if (updateXml) {
								mdArgs.sampleXmlResponse = fs.readFileSync(xmlFile, 'utf-8');
							}
						} // end if updateJson || updateXml

						methods[m] = mdArgs;
*/
					} // end for methods

					log.debug(JSON.stringify(methods, null, 2));
					epArgs = {
						path: { serviceId: apiId },
						data: {
							"name": cleanPath,
							"outboundRequestTargetPath": (basePath.pathname + p).replace("//", "/").replace(/{\?[A-Za-z0-9_,]+}/g, ""),
							"outboundTransportProtocol": basePath.protocol === 'https:' ? 'https' : 'http',
							"supportedHttpMethods": httpMethods,
							"methods": methods,
							"publicDomains": [{
								"address": trafficManagerHost
							}],
							"requestPathAlias": p.replace(/{\?[A-Za-z0-9_,]+}/g, ""), //(basePath.pathname + p).replace("//", "/"),
							"systemDomains": [{
								"address": basePath.host
							}],
							"inboundSslRequired": false
						}
					};

					if (!printOnly) {
						endpoints.push(epArgs);
					} else {
						endpointUrls.push(epArgs.data.name);
					}
					ep++;
				} // end if p.length > 0
			} // end for p in paths

			async.eachSeries(domains, whitelistDomain, function(err) {
				if (err) { reject(err); }
			});
			async.eachSeries(endpoints, createEndpoint, function(err) {
				if (err) { reject(err); }
				renderOutput();
			});
			
			resolve("OK");
		};

		swaggerDoc = options.swagger_content;
		
		if (swaggerDoc) {
			var host;
			if (swaggerDoc.schemes) {
				host = swaggerDoc.host && swaggerDoc.schemes ?
					swaggerDoc.schemes[0] + "://" + swaggerDoc.host +
					(swaggerDoc.basePath ? swaggerDoc.basePath : "") :
					swaggerDoc.basePath;
			} else if (swaggerDoc.servers) { // Swagger 3.0
				// TODO: what if there are more than one?
				host = swaggerDoc.servers[0].url;
			} else {
				host = swaggerDoc.host ?
					"http://" + swaggerDoc.host + (swaggerDoc.basePath ? swaggerDoc.basePath : "") :
					swaggerDoc.basePath;
			}

			console.log("########" + host);
			
			if (!host) {
				errorMsg = "Invalid Swagger document - missing host, servers and/or basePath entries";
				reject(errorMsg);
			}
			var basePath = url.parse(host);

			// get service metadata
			var svcArgs;
			if (swaggerDoc.info) {
				svcArgs = {
					data: {
						"name": swaggerDoc.info.title,
						"description": swaggerDoc.info.description ? swaggerDoc.info.description : "",
						"version": swaggerDoc.info.version ? swaggerDoc.info.version : "1.0"
					}
				};
			} else {
				svcArgs = {
					data: {
						"name": swaggerDoc.resourcePath ? swaggerDoc.resourcePath.substring(1) : basePath.path.substring(basePath.path.lastIndexOf('/') + 1),
						"version": swaggerDoc.apiVersion ? swaggerDoc.apiVersion : "1.0"
					}
				};
			}

			apiName = svcArgs.data.name;

			if (!printOnly) {
				delay(1000).then(() => {
					try {
						apiClient.methods.createService(svcArgs, function(serviceData, serviceRawResponse) {
							log.debug(serviceData);
							apiId = serviceData.id;
							apiName = serviceData.name;
							if (swaggerDoc.swaggerVersion) { // Swagger 1.2
								processSwagger12(resolve, reject, swaggerDoc, apiId, basePath);
							} else if (swaggerDoc.swagger) { // Swagger 2.0
								processSwagger20(resolve, reject, swaggerDoc, apiId, basePath);
							} else if (swaggerDoc.openapi) { // Swagger 3.0
								processSwagger30(resolve, reject, swaggerDoc, apiId, basePath);
							}
						});
					} catch (ex) {
						log.error(ex.message);
					}
				});
			} else {
				if (swaggerDoc.swaggerVersion) { // Swagger 1.2
					processSwagger12(resolve, reject, swaggerDoc, apiId, basePath);
				} else if (swaggerDoc.swagger) { // Swagger 2.0
					processSwagger20(resolve, reject, swaggerDoc, apiId, basePath);
				} else if (swaggerDoc.openapi) { // Swagger 3.0
					processSwagger30(resolve, reject, swaggerDoc, apiId, basePath);
				}
			}
		} else {
			reject(errorMsg ? errorMsg : "Unable to process Swagger");
		}


	});
	
	return promise;
};

module.exports = swagger2endpoint;
