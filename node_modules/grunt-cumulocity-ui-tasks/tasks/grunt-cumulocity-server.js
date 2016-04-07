var url = require('url'),
  path = require('path'),
  fs = require('fs'),
  _ = require('lodash'),
  st = require('connect-static-transform'),
  httpProxy = require('http-proxy');

module.exports = function (grunt) {
  'use strict';

  var TARGET = [
    grunt.config('cumulocity.protocol'),
    '://',
    grunt.config('cumulocity.host'),
    grunt.config('cumulocity.port') ? ':' + grunt.config('cumulocity.port') : ''
  ].join(''),
    proxy = httpProxy.createServer({
    secure: false,
    target: TARGET
  });

  function isCorePresent() {
    return !!getApp('core');
  }

  function getApp(contextpath) {
    var apps = grunt.config('localapps');
    return _.find(apps, function (a) {
      return a.contextPath === contextpath;
    });
  }

  function isIndex(req) {
    var app = req.localapp,
      plugin = req.localplugin,
      regex = app && new RegExp('/apps/' + app.contextPath + '/'),
      extractUrl = regex ? req.url.replace(regex, '') : 'none';

    return !extractUrl || extractUrl.match(/^index.html/);
  }


  function saveOriginal(req, res, next) {
    req.orig_url = req.url;
    next();
  }

  function findAppInContext(req, res, next) {
    var _path = url.parse(req.url).pathname,
      pathMatch = _path.match(/^\/apps\/([^\/]+)\/?/),
      appContextPath = pathMatch && pathMatch[1],
      apps = grunt.config('localapps');

    if (appContextPath) {
      req.localapp = _.find(apps, function (app) {
        return app.contextPath === appContextPath;
      });
      return findPlugin(req, res, next);
    }

    return next();
  }

  function findPlugin(req, res, next) {
    var _path = url.parse(req.url).pathname,
      pathMatch = _path.match(/^\/apps\/([^\/]+\/[^\/]+)\/?/),
      pluginContextPath = pathMatch && pathMatch[1],
      plugins = grunt.config('localplugins');

    if (pluginContextPath) {
      req.localplugin = _.find(plugins, function (plugin) {
        return pluginContextPath === plugin.__rootContextPath;
      });
    }

    return next();
  }


  function bower_components(req, res, next) {
    if (req.url.match('bower_components')) {
      req.url = req.url.replace(/.*bower_components/, '/bower_components');
    }
    next();
  }

  function parseManifestData(data) {
    var plugins = grunt.config('localplugins'),
      serverManifest = JSON.parse(data);

    //Replace plugins with local version of manifests
    serverManifest.imports.forEach(function (i) {
      var localP = _.find(plugins, function (p) {
        return p.__rootContextPath === i.rootContextPath;
      });

      if (localP) {
        _.merge(i, localP);
      }
    });

    return JSON.stringify(serverManifest);
  }

  function proxyServerRequest(req, res, next) {
    var toProxy = [
        'inventory',
        'user',
        'alarm',
        'event',
        'devicecontrol',
        'measurement',
        'identity',
        'application',
        'tenant',
        'cep',
        'apps',
        'vendme-service'
      ];

    //we change the url in many steps before, revert to original request
    req.url = req.orig_url;

    //Check if we should proxy this
    var proxied = _.any(toProxy, function (a) {
      return req.url.match(new RegExp('^/' + a));
    });

    if (proxied) {

      if (isIndex(req)) {
        req.url = '/apps/core/index.html';
      }

      delete req.headers.host;

      if (req.url.match('manifest')) {
        var _write = res.write,
          out = '';
        res.write = function (data) {
          out = out + data.toString();
          try {
            JSON.parse(out);
          } catch(e) {
            return;
          }
          _write.call(res, parseManifestData(out));
        };
      }

      return proxy.web(req, res);
    } else {
      next();
    }
  }

  function staticLocal(connect, req, res, next, isTemp) {
    var staticMiddleware;

    if (req.localapp) {

      if (req.url.match(/css$/)) {
        res.setHeader('Content-Type', 'text/css');
      }

      //Server local index
      if (isCorePresent() && isIndex(req)) {
        var coreApp = getApp('core');
        req.url = '/index.html';
        staticMiddleware = mnt(connect, coreApp.__dirnameTemp);
        return staticMiddleware(req, res, next);
      }

      //Serve bower components
      if (req.url.match('bower_components')) {
        req.url = req.url.replace(/.*bower_components/, '');
        staticMiddleware = mnt(connect, req.localapp.__dirname + '/bower_components');
        return staticMiddleware(req, res, next);
      }

      var dirnameVal = '__dirname' + (isTemp ? 'Temp' : '');
      staticMiddleware = mnt(connect, req.localapp[dirnameVal]);

      req.url = req.orig_url.replace('/apps/' + req.localapp.contextPath, '');
      if (req.localplugin) {
         var file = req.orig_url.replace('/apps/' + req.localplugin.__rootContextPath, ''),
            _path = path.resolve(req.localplugin[dirnameVal] + '/' + file);

        if (req.url.match(/(js|html|css)$/) && fs.existsSync(_path)) {

         var stream = fs.createReadStream(_path),
            res_write = res.write,
            res_end = res.end,
            out = '';

          stream.pipe(res);

          res.write = function (data) {
            out = out + data.toString();
            out = placeholders(req.localplugin, out);
            res_write.call(res, out);
          };

          res.end = function (data) {
            var _out = '' + (data ? data.toString() : '');
            _out = placeholders(req.localplugin, _out);
            res_end.call(res, _out);
          };
          return;

        } else {
          staticMiddleware = mnt(connect, req.localplugin[dirnameVal]);
          req.url = req.orig_url.replace('/apps/' + req.localplugin.__rootContextPath, '');
        }

      }

      return staticMiddleware(req, res, function () {
        if (!res.body && isTemp) {
          return staticLocal(connect, req, res, next, false);
        } else {
          next();
        }
      });
    }

    return next();
  }

  function mnt(connect, dir) {
    dir = grunt.template.process(dir, grunt.config);
    return connect.static(path.resolve(dir));
  }

  function placeholders(plugin, text) {
    var map = {
      ':::PLUGIN_PATH:::': ['/apps', plugin.__rootContextPath].join('/')
    };
    Object.keys(map).forEach(function (k) {
      text = text.replace(new RegExp(k, 'g'), map[k]);
    });
    return text;
  }

  function debug(req, res, next) {
    console.log(req.localapp, req.locaplugin);
    next();
  }

  function connectMidlewares(connect, options) {
    return [
      saveOriginal,
      findAppInContext,
      _.partialRight(_.partial(staticLocal, connect), true),
      proxyServerRequest
    ];
  }


  var port = grunt.option('localPort') || grunt.config('localPort') || 8000;
  grunt.loadNpmTasks('grunt-contrib-connect');
  grunt.config('connect', {
    options: {
      port: port,
      hostname: '0.0.0.0',
    },
    server: {
      options: {
        middleware: connectMidlewares
      }
    }
  });


  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.config('watch', {
    manifests: {
      files: ['cumulocity.json', '**/cumulocity.json'],
      tasks: ['readManifests']
    }
  });

};
