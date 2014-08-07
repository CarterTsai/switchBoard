/*jslint white: true */
/*global State, module, require, console */

/**
 * Copyright (c) 2014 brian@bevey.org
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

module.exports = (function () {
  'use strict';

  /**
   * @author brian@bevey.org
   * @fileoverview Basic control of Nest thermostat and Protect smoke detector.
   */
  return {
    version : 20140805,

    inputs : ['command', 'text', 'list', 'subdevice'],

    /**
     * Whitelist of available key codes to use.
     */
    keymap : ['Away', 'Home', 'Fan_On', 'Fan_Auto'],

    cToF : function (c) {
      return (c * 1.8) + 32;
    },

    fToC : function (f) {
      return (f - 32) / 1.8;
    },

    postPrepare : function (config) {
      var request = { host    : config.host,
                      port    : config.port,
                      path    : config.path,
                      method  : config.method,
                      headers : {
                        'Accept'                : 'application/json',
                        'Accept-Charset'        : 'utf-8',
                        'User-Agent'            : 'node-switchBoard',
                        'Content-Type'          : 'application/x-www-form-urlencoded'
                      }
                    };

      if((config.auth) && (config.auth.userId) && (config.auth.token)) {
        request.headers['X-nl-protocol-version'] = 1;
        request.headers['X-nl-user-id']          = config.auth.userId;
        request.headers.Authorization            = 'Basic ' + config.auth.token;
      }

      if(config.postRequest) {
        request.headers['Content-Length'] = config.postRequest.length;
      }

      return request;
    },

    /**
     * Prepare a POST data the request.
     */
    postData : function (nest) {
      var querystring = require('querystring'),
          value;

      if(nest.args) {
        value = JSON.stringify(nest.args);
      }

      else {
        value = querystring.stringify({
                  username : nest.username,
                  password : nest.password
                });
      }

      return value;
    },

    findLabel : function (id) {
      var location = '';

      id = id.replace('00000000-0000-0000-0000-0001000000', '');

      switch(id) {
        case '01' :
          location = 'Basement';
        break;

        case '0d' :
          location = 'Bedroom';
        break;

        case '03' :
          location = 'Den';
        break;

        case '10' :
          location = 'Dining Room';
        break;

        case '06' :
          location = 'Downstairs';
        break;

        case '00' :
          location = 'Entryway';
        break;

        case '0b' :
          location = 'Family Room';
        break;

        case '02' :
          location = 'Hallway';
        break;

        case '08' :
          location = 'Kids Room';
        break;

        case '0a' :
          location = 'Kitchen';
        break;

        case '0c' :
          location = 'Living Room';
        break;

        case '05' :
          location = 'Master Bedroom';
        break;

        case '0e' :
          location = 'Office';
        break;

        case '0f' :
          location = 'Upstairs';
        break;
      }

      return location;
    },

    getAuth : function (config, controller) {
      var that = this;

      config = config || {};

      config.callback = function (err, response) {
        var fs   = require('fs'),
            auth = {},
            cache;

        if(!err) {
          if(response.error) {
            console.log('\x1b[31mNest\x1b[0m: ' + response.error_description);
          }

          else {
            auth.url    = response.urls.transport_url.replace('https://', '').replace(':443', '');
            auth.token  = response.access_token;
            auth.userId = parseInt(response.userid, 10);
            auth.expire = new Date(response.expires_in).getTime();

            cache = fs.createWriteStream(__dirname + '/../tmp/nestAuth.json');
            cache.once('open', function() {
              console.log('\x1b[35mNest\x1b[0m: Auth data cached with URL');

              that.deviceList(auth, controller);

              cache.write(JSON.stringify(auth));
            });
          }
        }
      };

      this.send(config);
    },

    deviceList : function (auth, controller) {
      var config = {},
          that   = this;

      console.log('\x1b[35mNest\x1b[0m: Fetching device info');

      config.host     = auth.url;
      config.path     = '/v2/mobile/user.' + auth.userId;
      config.method   = 'GET';
      config.device   = { auth : auth, deviceId : controller.config.deviceId };

      config.callback = function(err, response) {
        var deviceState = require(__dirname + '/../lib/deviceState'),
            nest        = { thermostat : {}, protect : {} },
            i;

        if(response) {
          for(i in response.structure) {
            nest.structure = i;
            nest.presence  = response.structure[i].away === false ? 'on' : 'off';
            break;
          }

          // "topaz" contains only smoke detectors.
          for(i in response.topaz) {
            nest.protect[response.topaz[i].serial_number]         = {};
            nest.protect[response.topaz[i].serial_number].serial  = response.topaz[i].serial_number;
            nest.protect[response.topaz[i].serial_number].smoke   = response.topaz[i].smoke_status         === 0 ? 'ok' : 'err';
            nest.protect[response.topaz[i].serial_number].co      = response.topaz[i].co_status            === 0 ? 'ok' : 'err';
            nest.protect[response.topaz[i].serial_number].battery = response.topaz[i].battery_health_state === 0 ? 'ok' : 'err';
            nest.protect[response.topaz[i].serial_number].label   = that.findLabel(response.topaz[i].where_id);
          }

          // "device" contains only thermostats.
          for(i in response.device) {
            nest.thermostat[response.device[i].serial_number]          = {};
            nest.thermostat[response.device[i].serial_number].serial   = response.device[i].serial_number;
            nest.thermostat[response.device[i].serial_number].state    = response.shared[response.device[i].serial_number].target_temperature_type;
            nest.thermostat[response.device[i].serial_number].fanMode  = response.device[i].fan_mode;
            nest.thermostat[response.device[i].serial_number].humidity = response.device[i].current_humidity;
            nest.thermostat[response.device[i].serial_number].temp     = that.cToF(response.shared[response.device[i].serial_number].current_temperature);
            nest.thermostat[response.device[i].serial_number].target   = that.cToF(response.shared[response.device[i].serial_number].target_temperature);
            nest.thermostat[response.device[i].serial_number].label    = that.findLabel(response.device[i].where_id);
          }

          deviceState.updateState(controller.config.deviceId, 'nest', { state : 'ok', value : nest });
        }

        else {
          deviceState.updateState(controller.deviceId, 'nest', { state : 'err' });
        }
      };

      this.send(config);
    },

    /**
     * As devices can have the same names - but I assume they all want to be
     * interacted with in concert, we'll not use a hash table - and return an
     * object of applicable sub devices to act upon.
     */
    findSubDevices : function (subDeviceLabel, subDevices) {
      var subDevice = {},
          collected = [],
          i         = 0,
          j         = 0;

      for(i in subDevices) {
        subDevice = subDevices[i];

        if(subDevice.label === subDeviceLabel) {
          collected[j] = subDevice;
          j += 1;
        }
      }

      return collected;
    },

    getDevicePath : function (config) {
      var deviceState = require(__dirname + '/../lib/deviceState'),
          nestState   = deviceState.getDeviceState(config.deviceId),
          subDevices  = {},
          commandType = '',
          i           = 1,
          value       = '',
          command     = config.command,
          subdevice   = config.subdevice;

      // We can only send commands to thermostats.
      if((nestState.value) && (nestState.value.thermostat)) {
        subDevices = JSON.parse(JSON.stringify(nestState.value));
      }

      if(command === 'Home') {
        config.host = config.auth.url;
        config.path = '/v2/put/structure.' + subDevices.structure;
        config.args = { away : false, away_timestamp : new Date().getTime(), away_setter : 0 };
      }

      if(command === 'Away') {
        config.host = config.auth.url;
        config.path = '/v2/put/structure.' + subDevices.structure;
        config.args = { away : true, away_timestamp : new Date().getTime(), away_setter : 0 };
      }

      else if(command === 'Fan_On') {
        config.host = config.auth.url;
        config.path = '/v2/put/structure.' + subDevices.structure;
        config.args = { fan_mode : 'on' };
      }

      else if(command === 'Fan_Auto') {
        config.host = config.auth.url;
        config.path = '/v2/put/structure.' + subDevices.structure;
        config.args = { fan_mode : 'auto' };
      }

      else if(subdevice.indexOf('mode-') === 0) {
        commandType = 'mode';
      }

      else if(subdevice.indexOf('temp-') === 0) {
        commandType = 'temp';
      }

      if(commandType) {
        config.host = config.auth.url;

        command     = subdevice.replace(commandType + '-', '');

        value       = command.split('-');
        command     = value[0];
        value       = value[1];
        subdevice   = this.findSubDevices(command, subDevices.thermostat);

        switch(commandType) {
          case 'mode' :
            if((value === 'off') || (value === 'heat') || (value === 'cool')) {
              config.path = '/v2/put/shared.' + subdevice[0].serial;
              config.args = { target_change_pending : true, target_temperature_type : value };
            }
          break;

          case 'temp' :
            if(!isNaN(value)) {
              if((value >= 50) && (value <= 100)) {
                config.path = '/v2/put/shared.' + subdevice[0].serial;
                config.args = { target_change_pending : true, target_temperature : this.fToC(value) };
              }
            }
          break;
        }
      }

      return config;
    },

    init : function (controller, config) {
      var fs      = require('fs'),
          that    = this,
          auth    = {},
          groups  = config.groups || {},
          now     = new Date().getTime(),
          expired = true;

      if(typeof controller.config.username !== 'undefined' && controller.config.password !== 'undefined') {
        fs.exists(__dirname + '/../tmp/nestAuth.json', function(fileExists) {
          // If we have a presumed good auth token, we can populate the device list.
          if(fileExists) {
            fs.readFile(__dirname + '/../tmp/nestAuth.json', function(err, auth) {
              if(auth.toString()) {
                auth = JSON.parse(auth.toString());

                if((auth.expire) && (auth.expire > now)) {
                  expired = false;

                  if(typeof auth.url === 'string') {
                    controller.config.auth = auth;

                    controller.controller.deviceList(auth, controller);
                  }
                }

                else {
                  that.getAuth({ device : { deviceId : controller.config.deviceId, username : controller.config.username, password : controller.config.password } }, controller);
                }
              }

              else {
                console.log('\x1b[31mNest\x1b[0m: Auth cache is empty');
              }
            });
          }

          // Otherwise, we need to retrieve the auth token.
          else {
            that.getAuth({ device : { deviceId : controller.config.deviceId, username : controller.config.username, password : controller.config.password } }, controller);
          }
        });
      }

      return controller;
    },

    onload : function (controller) {
      var fs                 = require('fs'),
          deviceState        = require(__dirname + '/../lib/deviceState'),
          nestState          = deviceState.getDeviceState(controller.config.deviceId),
          parser             = require(__dirname + '/../parsers/nest').nest,
          thermostatFragment = fs.readFileSync(__dirname + '/../templates/fragments/nestThermostat.tpl').toString(),
          protectFragment    = fs.readFileSync(__dirname + '/../templates/fragments/nestProtect.tpl').toString(),
          groupFragment      = fs.readFileSync(__dirname + '/../templates/fragments/nestGroups.tpl').toString();

      return parser(controller.deviceId,
                    controller.markup,
                    nestState.state,
                    nestState.value,
                    { thermostat : thermostatFragment,
                      protect    : protectFragment,
                      group      : groupFragment });
    },

    send : function (config) {
      var https        = require('https'),
          nest         = {},
          postRequest  = '',
          dataReply    = '',
          request;

      nest.deviceId  = config.device.deviceId || '';
      nest.command   = config.command         || '';
      nest.subdevice = config.subdevice       || '';
      nest.list      = config.list            || '';
      nest.host      = config.host            || 'home.nest.com';
      nest.path      = config.path            || '/user/login';
      nest.port      = config.port            || 443;
      nest.method    = config.method          || 'POST';
      nest.callback  = config.callback        || function () {};
      nest.username  = config.device.username || '';
      nest.password  = config.device.password || '';
      nest.auth      = config.device.auth     || {};

      if((nest.command) || (nest.subdevice)) {
        nest = this.getDevicePath(nest);
      }

      if(nest.method === 'POST') {
        nest.postRequest = this.postData(nest);
      }

      if(nest.list) {
        this.deviceList(nest.auth, { config : { deviceId : config.device.deviceId } });
      }

      else {
        request = https.request(this.postPrepare(nest), function(response) {
          console.log('\x1b[32mNest\x1b[0m: Connected');

          response.on('data', function(response) {
            dataReply += response;
          });

          response.once('end', function() {
            var deviceState = require(__dirname + '/../lib/deviceState'),
                nestData    = {};

            if(dataReply) {
              nestData = JSON.parse(dataReply);

              nest.callback(null, nestData);
            }

            else {
              console.log('\x1b[31mNest\x1b[0m: No data returned from API');

              nest.callback(null, '');
            }
          });
        });

        request.once('error', function(err) {
          var errorMsg = '';

          if(err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH') {
            errorMsg = '\x1b[31mNest\x1b[0m: API is unreachable';
          }

          else {
            errorMsg = '\x1b[31mNest\x1b[0m: ' + err.code;
          }

          console.log(errorMsg);

          nest.callback(errorMsg);
        });

        if(nest.method === 'POST') {
          request.write(nest.postRequest);
        }

        request.end();
      }
    }
  };
}());
