var _ = require('lodash'),
  request = require('request');

module.exports = function (grunt) {
  'use strict';

  function getPlugin(_plugin) {
    var plugins = grunt.config('localplugins');

    if (!plugins) {
      grunt.task.run('readManifests');
      return;
    }

    var plugin = _.where(plugins, {contextPath: _plugin})[0];
    if (!plugin) {
      grunt.fail.fatal('Plugin not found: ' + _plugin);
    }
    return plugin;
  }

  function getCurrentPlugins() {
    var plugins = grunt.config('localplugins') || [];
    return _.filter(plugins, '__isCurrent');
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

  function pluginNeedsPrepocessor(p) {
    return !!p.less;
  }

  function preProcess(_plugin) {
    if (_plugin === 'all') {
      getCurrentPlugins()
        .filter(pluginNeedsPrepocessor)
        .forEach(function (p) {
          grunt.task.run('pluginPre:' + p.contextPath);
        });
      return;
    }

    var plugin = getPlugin(_plugin),
      tasks = [];

    if (!plugin) {
      grunt.task.run('pluginPre:' + _plugin);
      return;
    }

    var manifest = getManifest(plugin),
      pluginPath = '<%= paths.plugins %>/' + _plugin + '/';

    if (manifest.less) {
      var task = 'less.plugin_' + _plugin;
      grunt.config(task, {
        files : [
          {
            src: manifest.less.map(function (f) {
              return  pluginPath + f;
            }),
            dest: '<%= paths.temp %>/plugins/' + _plugin + '/style-less.css'
          }
        ]
      });
      grunt.config('watch.plugin_' + _plugin, {
        files: [pluginPath + '**/*.less', pluginPath + '*.less'],
        tasks: ['pluginPre:' + _plugin]
      });
      tasks.push('less:plugin_' + _plugin);
    }

    if (tasks.length) {
      tasks.forEach(function (t) {
        grunt.task.run(t);
      });
    } else {
      grunt.log.ok('Nothing to do..');
    }
  }

  function buildPlugin(_plugin) {
    if (_plugin === 'all') {
      getCurrentPlugins()
        .forEach(function (p) {
          grunt.task.run('pluginBuild:' + p.contextPath);
        });
      return;
    }

    if (!grunt.config('localApplication')) {
      grunt.config('localApplication', grunt.file.readJSON('cumulocity.json'));
    }

    var _app = grunt.config('localApplication').contextPath,
      plugin,
      tasks = [],
      hasLess = false,
      manPath = grunt.template.process('<%= paths.plugins %>/' + _plugin + '/cumulocity.json');

    if (getCurrentPlugins() && getCurrentPlugins().length) {
      plugin = _.find(getCurrentPlugins(), function (p) {
        return p.contextPath === _plugin;
      });
    } else if (grunt.file.exists(manPath)) {
      plugin = grunt.file.readJSON(manPath);
    }

    if (!plugin) {
      grunt.fail.fatal('Plugin not found: ' + _plugin);
    }

    plugin = getManifest(plugin);

    if (plugin.less) {
      grunt.config('less.plugin_' + _plugin, {
        files : [
          {
            src: plugin.less.map(function (f) {
              var isBower = f.match('bower_components');
              return isBower ? '<%= paths.root %>/' + f : '<%= paths.plugins %>/' + _plugin + '/' + f;
            }),
            dest: '<%= paths.temp %>/plugins/' + _plugin + '/style-less.css'
          }
        ]
      });
      tasks.push('less:plugin_' + _plugin);
      hasLess = true;
    }

    if (plugin.css || hasLess) {
      var cssFileList = plugin.css ? plugin.css.map(function (f) {
          var isBower = f.match('bower_components');
          return isBower ? '<%= paths.root %>/' + f : '<%= paths.plugins %>/' + _plugin + '/' + f;
        }) : [],
        css_cfg = {
          files: [
            {
              dest: '<%= paths.build %>/' + _plugin + '/style.css',
              src: cssFileList
            }
          ]
        },
        css_task = ['cssmin', 'plugin_' + _plugin];
      if (hasLess) {
        cssFileList.push('<%= paths.temp %>/plugins/' + _plugin + '/style-less.css');
      }
      grunt.config(css_task.join('.'), css_cfg);
      tasks.push(css_task.join(':'));
    }

    if (plugin.ngModules && grunt.file.exists(grunt.template.process('<%= paths.plugins%>/' + _plugin + '/views'))) {
      var ngview_cfg = {},
        ngview_task = ['ngtemplates', 'plugin_' + _plugin];
      grunt.config(ngview_task.join('.'),{
        cwd: '<%= paths.plugins %>/' + _plugin + '/',
        src: ['views/*.html','views/**.html'],
        dest:'<%= paths.temp%>/plugins/'  + _plugin + '/views.js',
        options: {
          prefix: ['/apps', _app, _plugin, ''].join('/'),
          module: plugin.ngModules[0],
          bootstrap: function(module, script) {
            script = "angular.module('" + module + "').run(['$templateCache', function($templateCache) {" +
              script + '\n}]);';
            return replaceStringsInCode(_app, _plugin, script);
          },
          htmlmin: {
            collapseBooleanAttributes:      true,
            collapseWhitespace:             true,
            removeAttributeQuotes:          true,
            removeComments:                 true,
            removeEmptyAttributes:          true,
            removeRedundantAttributes:      true,
            removeScriptTypeAttributes:     true,
            removeStyleLinkTypeAttributes:  true
          }
        }
      });
      tasks.push(ngview_task.join(':'));
    }

    if (plugin.js) {
      var jsFileList = plugin.js.map(function (f) {
          var isBower = f.match('bower_components');
          return isBower ? '<%= paths.root %>/' + f : '<%= paths.plugins %>/' + _plugin + '/' + f;
        }),
        cfg = {
          files: [
            {
              dest: '<%= paths.build %>/' + _plugin + '/main.js',
              src: jsFileList
            }
          ]
        },
        task = ['uglify', 'plugin_' + _plugin];

      if (plugin.ngModules) {
        jsFileList.push('<%= paths.temp%>/plugins/'  + _plugin + '/views.js');
      }

      grunt.config(task.join('.'), cfg);
      tasks.push(task.join(':'));
    }

    if (plugin.gallery || plugin.copy) {
      var copy_task = ['copy', 'plugin_' + _plugin],
        copy_cfg = {files: []};

      if (plugin.gallery) {
        copy_cfg.files.push({
          expand: true,
          dest: '<%= paths.build %>',
          cwd: '<%= paths.plugins %>',
          src: [_plugin + '/gallery/**']
        });
      }

      if (plugin.copy) {
        plugin.copy.map(function (c) {
          if (typeof c === 'string') {
            return {
              expand: true,
              cwd: '<%= paths.plugins %>',
              src: [_plugin + '/' + c],
              dest: '<%= paths.build %>'
            };
          }

          if (typeof c === 'object') {
            return {
              expand: true,
              cwd: '<%= paths.root %>/' + c.cwd,
              src: [c.files],
              dest: '<%= paths.build %>/' + _plugin
            };
          }
        }).forEach(function (c) {
          copy_cfg.files.push(c);
        });
      }

      grunt.config(copy_task.join('.'), copy_cfg);
      tasks.push(copy_task.join(':'));
    }

    var jsPath = grunt.template.process('<%= paths.build %>/' + _plugin + '/main.js');
    if (plugin.js) {
      tasks.push('pluginReplaceString:' + _plugin);
    }

    if (tasks.length) {
      tasks.forEach(function (t) {
        grunt.task.run(t);
      });
    } else {
      grunt.log.ok('Nothing to do');
    }
  }

  function replaceStringsInCode(_app, _plugin, code) {
    var map = {
      ':::PLUGIN_PATH:::': ['/apps',_app,_plugin].join('/')
    };

    Object.keys(map).forEach(function (key) {
      code = code.replace(new RegExp(key, 'g'), map[key]);
    });

    return code;
  }

  function replaceStringTask(_plugin) {
    if (!grunt.config('localApplication')) {
      grunt.config('localApplication', grunt.file.readJSON('cumulocity.json'));
    }

    var _app = grunt.config('localApplication').contextPath,
      plugin,
      manPath = grunt.template.process('<%= paths.plugins %>/' + _plugin + '/cumulocity.json');

    if (grunt.config('localPlugins')) {
      plugin = _.find(grunt.config('localPlugins'), function (p) {
        return p.contextPath === _plugin;
      });
    } else if (grunt.file.exists(manPath)) {
      plugin = {
        manifest: grunt.file.readJSON(manPath)
      };
    }

    var jsPath = grunt.template.process('<%= paths.build %>/' + _plugin + '/main.js');

    grunt.file.write(jsPath, replaceStringsInCode(_app, _plugin, grunt.file.read(jsPath)));

  }

  function downloadIndex() {
    var input = grunt.template.process('<%= cumulocity.protocol %>://<%= cumulocity.host %>/apps/core/index.html', grunt.config),
      output = grunt.template.process('<%= paths.build %>/index.html'),
      done = this.async();

    request(input, function (err, res, body) {
      grunt.file.write(output, body);
      done();
    });
  }

  grunt.loadNpmTasks('grunt-contrib-less');
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-contrib-cssmin');
  grunt.loadNpmTasks('grunt-angular-templates');
  grunt.loadNpmTasks('grunt-contrib-clean');

  grunt.config('clean.temp', ['<%= paths.temp %>']);

  grunt.registerTask('pluginPre',
    'Preprocesses a plugin',
    preProcess);

  grunt.registerTask('pluginBuild',
    'Builds a plugin for deployment',
    buildPlugin);

  grunt.registerTask('pluginReplaceString',
    'Replaces string for plugin path',
    replaceStringTask);

  grunt.registerTask('downloadIndex',
    'Download index.html from our default endpoint',
    downloadIndex);

  grunt.registerTask('pluginPreAll', [
    'readManifests',
    'pluginPre:all'
  ]);

  grunt.registerTask('pluginBuildAll', [
    'readManifests',
    'pluginBuild:all',
    'downloadIndex',
    'clean:temp'
  ]);

  grunt.registerTask('pluginBuildAllNoIndex', [
    'readManifests',
    'pluginBuild:all',
    'clean:temp'
  ]);
};
