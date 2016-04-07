var path = require('path'),
  _ = require('lodash');

module.exports = function (grunt) {
  'use strict';

  function readPluginsForApp(appManifest) {
    var plugins = [],
      manifestPath = appManifest.__dirname + '/{*/,}plugins/*/cumulocity.json',
      manifestPaths = grunt.file.expand(manifestPath) || [];

    return manifestPaths.map(function (_path) {
      var manifest = grunt.file.readJSON(_path),
        dirname = manifest.__dirname = path.dirname(_path),
        dirnameSplit = dirname.split('/'),
        contextPath = dirnameSplit.pop();

      manifest.__dirnameTemp = appManifest.__dirnameTemp + '/plugins/' + contextPath;
      manifest.__rootContextPath = appManifest.contextPath + '/' + contextPath;
      manifest.__isCurrent = appManifest.__isCurrent;
      manifest.contextPath = contextPath;
      return manifest;
    });
  }

  function readApplicationsAndPlugins() {
    var apps = [],
      plugins = [],
      currentApp = grunt.file.readJSON('./cumulocity.json'),
      appManifests = grunt.file.expand('../*/cumulocity.json') || [],
      port = 8000;

    appManifests.forEach(function (_path) {
      var manifest = grunt.file.readJSON(_path),
        dirname = path.dirname(_path),
        exists = _.find(apps, function (app) { return app.contextPath === manifest.contextPath; });

      if (!exists) {

        manifest.__dirnameTemp = dirname + '/.tmp';

        //hack for core.ui which is inside a ./app folder
        if (manifest.contextPath === 'core') {
          dirname = dirname + '/app';
        }

        manifest.__dirname = dirname;
        manifest.__port = port++;
        manifest.__isCurrent = currentApp.contextPath === manifest.contextPath;
        plugins.push(readPluginsForApp(manifest));
        apps.push(manifest);

        if (manifest.__isCurrent) {
          currentApp = manifest;
        }
      }
    });

    return {
      currentApp: currentApp,
      apps: apps,
      plugins: _.flatten(plugins)
    };
  }


  grunt.registerTask('readManifests', function () {
    var appsAndPlugins = readApplicationsAndPlugins(),
      currentApp = grunt.config('currentlocalapp', appsAndPlugins.currentApp),
      apps = grunt.config('localapps', appsAndPlugins.apps),
      plugins = grunt.config('localplugins', appsAndPlugins.plugins);

    grunt.log.subhead('Current app: ', currentApp.contextPath);
    var otherApps = apps.filter(function (a) {
      return a.contextPath !== currentApp.contextPath;
    });

    grunt.log.subhead(grunt.template.process('Other local apps (<%= total %>)' , {data: {
      total: otherApps.length
    }}));
    grunt.log.writeln(grunt.log.wordlist(_.pluck(otherApps, 'contextPath')));

    var currentPlugins = _.filter(plugins, '__isCurrent'),
      otherPlugins = _.filter(plugins, {'__isCurrent': false});

    grunt.log.subhead(grunt.template.process('Plugins in current app (<%= total %>)', {data: {
      total: currentPlugins.length
    }}));
    grunt.log.writeln(grunt.log.wordlist(_.pluck(currentPlugins, 'contextPath')));

    grunt.log.subhead(grunt.template.process('Plugins in other local apps (<%= total %>)' , {data: {
      total: otherPlugins.length
    }}));
    grunt.log.writeln(grunt.log.wordlist(_.pluck(otherPlugins, 'contextPath')));

  });

};