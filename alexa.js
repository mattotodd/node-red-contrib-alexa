/**
 * Copyright 2014 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

module.exports = function(RED) {
    "use strict";
    var alexa = require('./vendor/alexa-app');
    var verifier = require('alexa-verifier');
    var mustache = require('mustache');

    var skills = {};

    function createResponseWrapper(node,res) {
        var wrapper = {
            _res: res
        };
        var toWrap = [
            "append",
            "attachment",
            "cookie",
            "clearCookie",
            "download",
            "end",
            "format",
            "get",
            "json",
            "jsonp",
            "links",
            "location",
            "redirect",
            "render",
            "send",
            "sendfile",
            "sendFile",
            "sendStatus",
            "set",
            "status",
            "type",
            "vary"
        ];
        toWrap.forEach(function(f) {
            wrapper[f] = function() {
                node.warn(RED._("alexa-httpin.errors.deprecated-call",{method:"msg.res."+f}));
                var result = res[f].apply(res,arguments);
                if (result === res) {
                    return wrapper;
                } else {
                    return result;
                }
            }
        });
        return wrapper;
    }

    function validateAlexaRequest(req, res, next) {
      if (!RED.settings.alexa || !RED.settings.alexa.verifyRequests){
        return next();
      }else if(!req.headers.signaturecertchainurl){
        res.status(403).json({ status: 'failure', reason: er });
      }
      var er;
      // mark the request body as already having been parsed so it's ignored by 
      // other body parser middlewares 
      req._body = true;
      req.rawBody = '';
      req.on('data', function(data) {
        return req.rawBody += data;
      });
      req.on('end', function() {
        var cert_url, er, error, requestBody, signature;
        try {
          req.body = JSON.parse(req.rawBody);
        } catch (error) {
          er = error;
          req.body = {};
        }
        cert_url = req.headers.signaturecertchainurl;
        signature = req.headers.signature;
        requestBody = req.rawBody;
        verifier(cert_url, signature, requestBody, function(er) {
          if (er) {
            RED.log.error('error validating the alexa cert:', er);
            res.status(401).json({ status: 'failure', reason: er });
          } else {
            next();
          }
        });
      });
    }

    function setupAlexaHttpHandler(node, type){
        var skillConfig = node.skillConfig;
        if(!skills.hasOwnProperty(skillConfig.id)){
            skillConfig.intents = JSON.parse(skillConfig.intents);
            //setup skill
            var skill = new alexa.app(skillConfig.skillname);
            skills[skillConfig.id] = {
                skill: skill,
                launches: [],
                intents: [],
                sessionEnds: []
            };

            for (var i =0;i<skillConfig.intents.length;i++){
                var intent = skillConfig.intents[i];
                skill.intent(intent.name, intent.options,
                  function(request,response, state) {
                    var msgid = RED.util.generateId();
                    for(var n=0;n<skills[skillConfig.id].intents.length;n++){
                        skills[skillConfig.id].intents[n].send({
                            _msgid:msgid,
                            req:state.req,
                            res:createResponseWrapper(skills[skillConfig.id].intents[n], state.res),
                            alexaRequest: request,
                            alexaResponse: response,
                            payload:state.req.body
                        });
                    }
                  }
                );
            }

            skill.launch(function(request,response, state) {
                var msgid = RED.util.generateId();
                for(var n=0;n<skills[skillConfig.id].launches.length;n++){
                    skills[skillConfig.id].launches[n].send({
                        _msgid:msgid,
                        req:state.req,
                        res:createResponseWrapper(skills[skillConfig.id].launches[n], state.res),
                        alexaRequest: request,
                        alexaResponse: response,
                        payload:state.req.body
                    });
                }
            });

            skill.sessionEnded(function(request,response, state) {
                var msgid = RED.util.generateId();
                for(var n=0;n<skills[skillConfig.id].sessionEnds.length;n++){
                    skills[skillConfig.id].sessionEnds[n].send({
                        _msgid:msgid,
                        req:state.req,
                        res:createResponseWrapper(skills[skillConfig.id].sessionEnds[n], state.res),
                        alexaRequest: request,
                        alexaResponse: response,
                        payload:state.req.body
                    });
                }
            });

            //setup alexa http handler

            var errorHandler = function(err,req,res,next) {
                node.warn(err);
                res.sendStatus(500);
            };

            var callback = function(req,res) {
                skill.request(req.body, {req:req, res:res})
                .catch(function(e){
                    res.sendStatus(500);
                    RED.log.error("Error handling alexa request", e);
                });
            };

            var httpMiddleware = function(req,res,next) { next(); }

            if (RED.settings.httpNodeMiddleware) {
                if (typeof RED.settings.httpNodeMiddleware === "function") {
                    httpMiddleware = RED.settings.httpNodeMiddleware;
                }
            }
            var url = '/'+ skillConfig.id +'/alexa';
            RED.httpNode.post(url, validateAlexaRequest, httpMiddleware, callback, errorHandler); 
        }

        switch(type){
            case "LaunchRequest":
                skills[skillConfig.id].launches.push(node);
                break;
            case "IntentRequest":
                skills[skillConfig.id].intents.push(node);
                break;
            case "SessionEndRequest":
                skills[skillConfig.id].sessionEnds.push(node);
                break;
            default:
                RED.log.error("Unknown alexa request type: " + type);
                break;
        }
    }

    function AlexaSkillConfig(n) {
        RED.nodes.createNode(this,n);
        this.skillname = n.skillname;
        this.intents = n.intents;
        var node = this;
    }
    RED.nodes.registerType("alexa-skill", AlexaSkillConfig);

    function AlexaHTTPLaunch(n) {
        RED.nodes.createNode(this,n);
        this.skillConfig = RED.nodes.getNode(n.skillConfig);
        if (RED.settings.httpNodeRoot !== false) {
            var node = this;

            setupAlexaHttpHandler(node, "LaunchRequest");

            this.on("close",function() {
                var node = this;
                RED.httpNode._router.stack.forEach(function(route,i,routes) {
                    if (route.route && route.route.path === node.url && route.route.methods[node.method]) {
                        routes.splice(i,1);
                    }
                });
            });
        } else {
            this.warn(RED._("common.errors.http-root-not-enabled"));
        }
    }
    RED.nodes.registerType("alexa-http launch", AlexaHTTPLaunch);

    function AlexaHTTPIntent(n) {
        RED.nodes.createNode(this,n);
        this.skillConfig = RED.nodes.getNode(n.skillConfig);
        if (RED.settings.httpNodeRoot !== false) {
            var node = this;

            setupAlexaHttpHandler(node, "IntentRequest");

            this.on("close",function() {
                var node = this;
                RED.httpNode._router.stack.forEach(function(route,i,routes) {
                    if (route.route && route.route.path === node.url && route.route.methods[node.method]) {
                        routes.splice(i,1);
                    }
                });
            });
        } else {
            this.warn(RED._("common.errors.http-root-not-enabled"));
        }
    }
    RED.nodes.registerType("alexa-http intent", AlexaHTTPIntent);

    function AlexaHTTPSessionEnd(n) {
        RED.nodes.createNode(this,n);
        this.skillConfig = RED.nodes.getNode(n.skillConfig);
        if (RED.settings.httpNodeRoot !== false) {
            var node = this;

            setupAlexaHttpHandler(node, "SessionEndRequest");

            this.on("close",function() {
                var node = this;
                RED.httpNode._router.stack.forEach(function(route,i,routes) {
                    if (route.route && route.route.path === node.url && route.route.methods[node.method]) {
                        routes.splice(i,1);
                    }
                });
            });
        } else {
            this.warn(RED._("common.errors.http-root-not-enabled"));
        }
    }
    RED.nodes.registerType("alexa-http session-end", AlexaHTTPSessionEnd);

    function AlexaSay(n) {
        RED.nodes.createNode(this,n);
        var node = this;
        node.text = n.text;
        this.on("input",function(msg) {
            if (msg.alexaResponse) {
                var renderedMsg = mustache.render(node.text, msg);
                msg.alexaResponse.say(renderedMsg);
            } else {
                node.warn(RED._("common.errors.no-alexa-response"));
            }
            node.send(msg);
        });
    }
    RED.nodes.registerType("alexa-say", AlexaSay);

    function AlexaCard(n) {
        RED.nodes.createNode(this,n);
        var node = this;
        node.cardjson = n.cardjson;
        this.on("input",function(msg) {
            if (msg.alexaResponse) {
                var renderedJson = mustache.render(node.cardjson, msg);
                msg.alexaResponse.card(JSON.parse(renderedJson));
            } else {
                node.warn(RED._("common.errors.no-alexa-response"));
            }
            node.send(msg);
        });
    }
    RED.nodes.registerType("alexa-card", AlexaCard);

    function AlexaLinkAccount(n) {
        RED.nodes.createNode(this,n);
        var node = this;
        this.on("input",function(msg) {
            if (msg.alexaResponse) {
                msg.alexaResponse.linkAccount();
            } else {
                node.warn(RED._("common.errors.no-alexa-response"));
            }
            node.send(msg);
        });
    }
    RED.nodes.registerType("alexa-link-account", AlexaLinkAccount);

    function AlexaHTTPOut(n) {
        RED.nodes.createNode(this,n);
        var node = this;
        this.on("input",function(msg) {
            if (msg.alexaResponse) {
                msg.res._res.set({'Content-Type':'application/json; charset=utf-8'});
                if (msg.res._res.get('content-length') == null) {
                    var len;
                    if (msg.alexaResponse.response == null) {
                        len = 0;
                    } else if (Buffer.isBuffer(msg.alexaResponse.response)) {
                        len = msg.alexaResponse.response.length;
                    } else {
                        len = Buffer.byteLength(msg.alexaResponse.response);
                    }
                    msg.res._res.set('content-length', len);
                }

                msg.res._res.status(200).json(msg.alexaResponse.response);
                
            } else {
                node.warn(RED._("common.errors.no-alexa-response"));
            }
        });
    }
    RED.nodes.registerType("alexa-http response", AlexaHTTPOut);

    RED.httpAdmin.post('/alexa/format-intents', RED.auth.needsPermission(""), function(req, res, next) {
        var intents = JSON.parse(req.body.intents);
        var skill = new alexa.app(req.body.skillname);

        for (var i =0;i<intents.length;i++){    
            var intent = intents[i];
            skill.intent(intent.name, intent.options);
        }

        var response = {};
        response.schema = skill.schema();
        response.utterances = skill.utterances()
        res.json(response);
    });
}