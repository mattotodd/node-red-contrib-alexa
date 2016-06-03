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
    var alexa = require('../vendor/alexa-app');
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

    function setupAlexaHttpHandler(node, type){
        var skillConfig = node.skillConfig;
        if(!skills.hasOwnProperty(skillConfig.id)){
            //setup skill
            var skill = new alexa.app(skillConfig.skillname);
            skills[skillConfig.id] = {
                skill: skill,
                launches: [],
                intents: [],
                sessionEnds: []
            };

            for (var i =0;i<node.skillConfig.intents.length;i++){
                var intent = node.skillConfig.intents[i];
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
                .catch(e => {
                    RED.log.error(e);
                });
            };

            var httpMiddleware = function(req,res,next) { next(); }

            if (RED.settings.httpNodeMiddleware) {
                if (typeof RED.settings.httpNodeMiddleware === "function") {
                    httpMiddleware = RED.settings.httpNodeMiddleware;
                }
            }
            var url = '/'+ skillConfig.id +'/alexa';
            RED.httpNode.post(url, httpMiddleware, callback, errorHandler); 
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
    RED.nodes.registerType("alexa-skill-config", AlexaSkillConfig);

    function AlexaHTTPIntent(n) {
        RED.nodes.createNode(this,n);
        this.skillConfig = n.skillConfig;
        if (RED.settings.httpNodeRoot !== false) {
            var node = this;
            node.skillConfig = {id:"testconfig"};
            node.skillConfig.skillname = 'Sample';
            node.skillConfig.intents = [{
                name:'SayNumber',
                options: {
                    slots:{number:"NUMBER"},
                    utterances:[ "say the number {1-100|number}" ]
                }
            }];

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
            this.warn(RED._("alexa-httpin.errors.not-created"));
        }
    }
    RED.nodes.registerType("alexa-http intent", AlexaHTTPIntent);

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
                node.warn(RED._("alexa-httpin.errors.no-alexa-response"));
            }
        });
    }
    RED.nodes.registerType("alexa-http response", AlexaHTTPOut);

    function AlexaSay(n) {
        RED.nodes.createNode(this,n);
        var node = this;
        this.on("input",function(msg) {
            if (msg.alexaResponse) {
                msg.alexaResponse.say("Hello world");
            } else {
                node.warn(RED._("alexa-httpin.errors.no-alexa-response"));
            }
            node.send(msg);
        });
    }
    RED.nodes.registerType("alexa-say", AlexaSay);
}