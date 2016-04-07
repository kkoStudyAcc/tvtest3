var request = require('request'),
  _ = require('lodash'),
  Q = require('q');

var tenant,
  user,
  pass,
  host,
  protocol,
  port;

function init(_tenant, _user, _password, _host, _protocol, _port) {
  tenant = _tenant;
  user = _user;
  pass = _password;
  host = _host;
  protocol = _protocol;
  port = _port;
}

function buildUrl(path) {
  var proto = protocol || 'http',
    _host = host || (tenant + '.cumulocity.com');

  return [
    proto,
    '://',
    _host,
    port ? ':' + part : '',
    '/',
    path
  ].join('');
}

function getUsername() {
  return tenant + '/' + user;
}

function getManifest(plugin) {
    var manifest = _.clone(plugin);
    _.forEach(manifest, function (val, key) {
      if (key.match(/^__/)) {
        delete manifest[key];
      }
    });
    return manifest;
  }


function genericRequest(path, _method, data, type) {
  var defer = Q.defer(),
    url = buildUrl(path),
    method = _method || 'GET',
    headers = type && {
      'Content-Type': type,
      Accept: type
    };

  request({
    url : url,
    method: method,
    body: data ? JSON.stringify(data) : undefined,
    headers: headers,
    auth: {
      user: getUsername(),
      pass: pass,
      sendImmediatly: true
    }
  }, function (err, res, body) {
    if (err) {
      return defer.reject(err);
    }

    try {
      body = JSON.parse(body);
    } catch(e) {

    }

    if (res.statusCode >= 400) {
      return defer.reject({
        statusCode: res.statusCode,
        body: body
      });
    }

    if (!body && res.headers.location) {
      var id = location.match(/\d+$/)[0];
      body._id = id;
    }

    defer.resolve(body);
  });

  return defer.promise;
}

function findApplication(_app) {
  var path = '/application/applicationsByOwner/' + tenant + '?pageSize=1000';
  return genericRequest(path).then(function (data) {
    var apps = data.applications,
      existingApp = _.find(apps, function (a) {
        return a.contextPath === _app.contextPath;
      });
    if (existingApp) {
      _app.id = existingApp.id;
    }
    return _app;
  });
}

function findPlugin(_plugin) {
  var path = 'application/plugins?pageSize=1000';

  return genericRequest(path).then(function (data) {
    var plugins = data.plugins,
      existingPlugin = _.find(plugins, function (p) {
        return p.contextPath === _plugin.rootContextPath;
      });

    if (existingPlugin) {
      _plugin.id = existingPlugin.id;
    }

    return _plugin;
  });
}

function buildManifest(app) {
  var manifest = {
    imports: app.imports,
    exports: app.exports,
    noAppSwitcher: app.noAppSwitcher,
    tabsHorizontal: app.tabsHorizontal
  };

  return manifest;
}

function saveApplication(_app) {
  var path = ['application/applications', _app.id  ? '/' + _app.id : ''].join(''),
    method = _app.id ? 'PUT' : 'POST',
    manifest = buildManifest(_app),
    type = 'application/vnd.com.nsn.cumulocity.application+json',
    app = _.clone(_app);

  delete app.imports;
  delete app.exports;
  delete app.noAppSwitcher;
  delete app.tabsHorizontal;

  if (app.id) {
    delete app.type;
  }
  app.manifest = manifest;
  return genericRequest(path, method, app, type)
    .then(function (newApp) {
      return newApp;
    });
}

function savePlugin(_plugin) {
  var path = [
      'application/applications/',
      _plugin.app_id,
      '/plugins',
      _plugin.id ? '/' + _plugin.id : ''
    ].join(''),
    method = _plugin.id ? 'PUT' : 'POST',
    manifest = getManifest(_plugin),
    type =  'application/vnd.com.nsn.cumulocity.plugin+json',
    plugin = {
      manifest: manifest,
      directoryName: manifest.directoryName
    };

  if (manifest.id) {
    plugin.id = manifest.id;
    delete manifest.id;
  }

  manifest.js = !!manifest.js;
  manifest.css = !!manifest.css || !!manifest.less;

  delete manifest.less;
  delete manifest.app_id;

  return genericRequest(path, method, plugin, type);
}

module.exports = {
  init: init,
  findApplication: findApplication,
  findPlugin: findPlugin,
  saveApplication: saveApplication,
  savePlugin: savePlugin
};

