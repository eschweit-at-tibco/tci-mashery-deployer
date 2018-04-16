var bunyan  = require('bunyan');         // Logging
var path    = require('path');           // Directory
var fs		= require('fs');        
var swagger = require('swagger-parser'); // Swagger validator
var url		= require('url'); // URL parser

var description = 'parsettciapplist';
var log = bunyan.createLogger({
    name: description,
    serializers: {
        req: bunyan.stdSerializers.req,
        res: bunyan.stdSerializers.res,
        err: bunyan.stdSerializers.err
    },
    level : bunyan.DEBUG    // TODO: change this to DEBUG if needed
});

function parsetciapplist(options) {
	return new Promise((resolve, reject) => {
		var applistUrl = options.applist_url;
		var parsedUrl = url.parse(applistUrl);
		var applistDoc = null;

		log.debug("parsedUrl=" + JSON.stringify(parsedUrl));
		
		var processStream = function (response) {
			// save the data
			var applist = '';
			response.on('data', function (chunk) {
				applist += chunk;
			});

			response.on('end', function () {
				var currentIndex = 0;
				var appsDetails = {};
				
				try {
					while (currentIndex >= 0) {
						applist = applist.substr(currentIndex);

						var nIndex = applist.match('Name                    :  (.*)\n');
						var sIndex = applist.match('Sandbox                 :  (.*)\n');
						var zIndex = applist.match('=* ==*.*\n');

						if (nIndex && sIndex && zIndex) {
							var endpointlist = applist.slice(sIndex.index + sIndex[0].length,
															 zIndex.index);
							var appDetails = {
								name: nIndex[1].trim(),
								sandbox: sIndex[1].trim(),
								endpoints: {}
							};
							
							var eIndex = endpointlist.match('Endpoint                :  (.*)\n');

							while (eIndex != null) {
								var endpointData = eIndex[1].trim();
								var endpointName = endpointData.match('.*/(.*)$')[1];
								appDetails.endpoints[endpointName] = endpointData;
								endpointlist = endpointlist.substr(eIndex.index + eIndex[0].length);
								eIndex = endpointlist.match('                        :  (.*)\n');
							}
							currentIndex = zIndex.index + zIndex[0].length;
							appsDetails[appDetails.name] = appDetails;
						} else {
							currentIndex = -1;
						}
					}
					
					resolve(appsDetails);
				} catch (e) {
					log.debug(e);
					errorMsg = "Unable to parse applist from " + applistUrl;
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

module.exports = parsetciapplist;
