var swagger2iodocs		= require('./lib/swagger2iodocs');
var swagger2endpoint	= require('./lib/swagger2endpoint');
var parsetcimanifest	= require('./lib/parsetcimanifest');
var parsetciapplist		= require('./lib/parsetciapplist');
var url					= require('url'); // URL parser
var delay = require('delay');

var args = process.argv.slice(2);

var manifest_url = 'file://' + args[0].split('\\').join('/');
var applist_url = 'file://' + args[1].split('\\').join('/');

parsetciapplist({ applist_url: applist_url })
.then(appsDetails => {
	parsetcimanifest({ manifest_url: manifest_url })
	.then(manifest => {
		manifest.endpoints.forEach(endpoint => {
			if (endpoint.name) { // for some reason sometimes empty for private endpoints
				var app = appsDetails[manifest.name];
				var ep = app ? app.endpoints[endpoint.name] : null;
				
				if (ep) {
					var parsedUrl = url.parse(ep);

					endpoint.swagger.host = parsedUrl.host;
					endpoint.swagger.basePath = parsedUrl.path;
					endpoint.swagger.schemes = [ parsedUrl.protocol.slice(0, parsedUrl.protocol.length-1) ]; // for some reason there is a column at end of protocol
				} else {
					console.log("Could not find match for " + endpoint.name);
				}
			}
		});
			
		manifest.endpoints.forEach( endpoint => {
			if (endpoint.name) {
				console.log("ENDPOINT " + endpoint.name);
				swagger2endpoint({
					print_only: false,
					validate_swagger: false,
					replace_accented: true,
					swagger_content: endpoint.swagger
				}).then(function(fulfilled) {
					console.log('Endpoints OK');
				}).catch(function(error) {
					console.log('Endpoints Error ' + error);
				});

				delay(2000).then(() => {
					swagger2iodocs({
						print_only: false,
						validate_swagger: false,
						replace_accented: true,
						swagger_content: endpoint.swagger
					}).then(function(fulfilled) {
						console.log('IOdocs OK');
					}).catch(function(error) {
						console.log('IODocs Error ' + error);
					});
				});
			}
		});
	})
	.catch(error => {
		console.log("ERROR " + error);
	});
})
.catch(error => {
	console.log("ERROR " + error);
});


