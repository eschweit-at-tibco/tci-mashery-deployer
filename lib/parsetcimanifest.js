var bunyan  = require('bunyan');         // Logging
var path    = require('path');           // Directory
var fs		= require('fs');        
var swagger = require('swagger-parser'); // Swagger validator
var url		= require('url'); // URL parser

var description = 'parsetcimanifest';
var log = bunyan.createLogger({
    name: description,
    serializers: {
        req: bunyan.stdSerializers.req,
        res: bunyan.stdSerializers.res,
        err: bunyan.stdSerializers.err
    },
    level : bunyan.DEBUG    // TODO: change this to DEBUG if needed
});

function parsetcimanifest(options) {
	return new Promise((resolve, reject) => {
		var manifestUrl = options.manifest_url;
		var parsedUrl = url.parse(manifestUrl);

		var manifestDoc = null;

		log.debug("parsedUrl=" + JSON.stringify(parsedUrl));
		
		var processStream = function (response) {
			// save the data
			var json = '';
			response.on('data', function (chunk) {
				json += chunk;
			});

			response.on('end', function () {
				try {
					manifestDoc = JSON.parse(json);
					var appDetails = {
						name: manifestDoc.name,
						endpoints: []
					};
					
					manifestDoc.endpoints.forEach(ep => {
						appDetails.endpoints.push({ name: ep.name, swagger: ep.swagger });
					});
					
					resolve(appDetails);
				} catch (e) {
					errorMsg = "Unable to parse Manifest from " + manifestUrl;
					log.debug(errorMsg);
					reject(errorMsg);
				}
			});
		};
				
		if (parsedUrl.protocol && typeof parsedUrl.protocol !== 'undefined') {
			// Load manifest from URL
			var protocol = (parsedUrl.protocol === 'https:' ? https : (parsedUrl.protocol === 'http:' ? http : null));
			if (protocol) {
				protocol.get(parsedUrl, processStream);
			} else if (parsedUrl.protocol === 'file:') {
				processStream(fs.createReadStream(parsedUrl.host + parsedUrl.pathname, "utf-8"));			
			} else {
				errorMsg = "Invalid Manifest URL: " + manifestUrl;
				log.debug(errorMsg);
				reject(errorMsg);
			}
		}
	});
}

module.exports = parsetcimanifest;
