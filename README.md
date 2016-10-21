node-red-contrib-alexa
======================

[![NPM](https://nodei.co/npm/node-red-contrib-alexa.png)](https://nodei.co/npm/node-red-contrib-alexa/)

[Node-Red][1] node for Amazon [Alexa Skills Kit (ASK)][2].

The library makes use of the [alexa-app][3] package to format requests as well as define your schema and utterances

#Install

Run the following command in the root directory of your Node-RED install

    npm install node-red-contrib-alexa

#Example

For an example, see the [node-red-alexa](https://github.com/mattotodd/node-red-alexa) fork of node-red that includes this library

#Usage

The pattern of usage is similar to using node-reds http in and out nodes.

#### Enable Verification of incoming requests

To verify incoming requests are coming from Amazon, you can set `alexa.verifyRequests` to true in your node-red settings. 
(add the alexa key if it doesn't already exist)

```javascript
	//  node-red settings file
	
	},
	alexa: {
        verifyRequests: true
    },
```

#Nodes

### Config Node (alexa-skill-config)

This node is used to define your skill, and can be used across multiple Alexa Request nodes. The skills tab will
format you schema and untterances to make it easier to submit them to amazon.

The nodes within this library map to the [ASK documentation][4]

### Launch Request (alexa-http launch)

This node receives a LaunchRequest when the user invokes the skill with the invocation name, but does not provide any command mapping to an intent.

### Intent Request (alexa-http intent)

This node receives an IntentRequest when the user speaks a command that maps to an intent. The request object sent to your service includes the specific intent and any defined slot values.

### SessionEnd Request (alexa-http session-end)

Your service receives a SessionEndedRequest when a currently open session is closed

### Say (alexa-say)

Tell Alexa to say something. Can use multiple `say` nodes and the phrases will be appended to each other

### Card (alexa-card)

Adds a card to the users Alexa app

### Link Account (alexa-link-account)

Adds a card to the response instructing the user how to link their account to the skill.

### Response (alexa-http response)

Completes a response from an alexa request. Required for any Launch, Intent or SessionEnd request.


[1]:http://nodered.org
[2]:https://developer.amazon.com/public/solutions/alexa/alexa-skills-kit
[3]:https://www.npmjs.com/package/alexa-app
[4]:https://developer.amazon.com/public/solutions/alexa/alexa-skills-kit/docs/alexa-skills-kit-interface-reference