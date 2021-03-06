/*jslint white: true */
/*global module, require, console */

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
   * @requires fs, https
   * @fileoverview Basic weather information, courtesy of Yahoo.
   */
  return {
    version : 20140813,

    inputs  : ['list'],

    /**
     * Reference template fragments to be used by the parser.
     */
    fragments : function () {
      var fs = require('fs');

      return { forecast : fs.readFileSync(__dirname + '/../templates/fragments/weather.tpl').toString() };
    },

    /**
     * Prepare a request for command execution.
     */
    postPrepare : function (config) {
      return { host   : config.host,
               port   : config.port,
               path   : config.path.split(' ').join('%20'),
               method : config.method };
    },

    /**
     * Grab the latest state as soon as SwitchBoard starts up.
     */
    init : function (controller) {
      var runCommand = require(__dirname + '/../lib/runCommand');

      runCommand.runCommand(controller.config.deviceId, 'list', controller.config.deviceId);
    },

    send : function (config) {
      var https     = require('https'),
          weather   = {},
          dataReply = '',
          request;

      weather.deviceId = config.device.deviceId;
      weather.zip      = config.device.zip;
      weather.woeid    = config.device.woeid;
      weather.host     = config.host     || 'query.yahooapis.com';
      weather.path     = config.path     || '/v1/public/yql?format=json&q=select * from weather.forecast where ' + (weather.woeid ? 'woeid=' + weather.woeid : 'location=' + weather.zip);
      weather.port     = config.port     || 443;
      weather.method   = config.method   || 'GET';
      weather.callback = config.callback || function () {};

      if((weather.zip !== null) || (weather.woeid !== null)) {
        console.log('\x1b[35m' + config.device.title + '\x1b[0m: Fetching device info');

        request = https.request(this.postPrepare(weather), function(response) {
                    response.setEncoding('utf8');

                    response.on('data', function(response) {
                      dataReply += response;
                    });

                    response.once('end', function() {
                      var deviceState = require(__dirname + '/../lib/deviceState'),
                          weatherData = {},
                          city;

                      if(dataReply) {
                        dataReply = JSON.parse(dataReply);

                        if((dataReply.query) && (dataReply.query.results)) {
                          city = dataReply.query.results.channel;

                          if(city.title.indexOf('Error') !== -1) {
                            deviceState.updateState(weather.deviceId, 'weather', { state : 'err', value : city.title });
                          }

                          else {
                            weatherData = { 'city'     : city.location.city,
                                            'temp'     : city.item.condition.temp,
                                            'text'     : city.item.condition.text,
                                            'humidity' : city.atmosphere.humidity,
                                            'sunrise'  : city.astronomy.sunrise,
                                            'sunset'   : city.astronomy.sunset,
                                            'code'     : city.item.condition.code,
                                            'forecast' : city.item.forecast
                                          };

                            deviceState.updateState(weather.deviceId, 'weather', { state : 'ok', value : weatherData });
                          }

                          weather.callback(null, weatherData);
                        }

                        else {
                          weather.callback('No data returned from API');
                        }
                      }

                      else {
                        weather.callback('No data returned from API');
                      }
                    });
                  });

        request.once('error', function(err) {
          weather.callback(err);
        });

        request.end();

        return dataReply;
      }

      else {
        weather.callback('No zip code specified');
      }
    }
  };
}());
