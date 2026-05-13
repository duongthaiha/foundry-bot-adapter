require('dotenv').config();

const express = require('express');
const {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication
} = require('botbuilder');
const { loadConfig } = require('./config');
const { FoundryBot } = require('./bot');
const { FoundryClient } = require('./foundryClient');

const config = loadConfig();
const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  next();
});

app.use(express.json({ limit: '1mb' }));

const botFrameworkAuthentication = new ConfigurationBotFrameworkAuthentication(process.env);
const adapter = new CloudAdapter(botFrameworkAuthentication);
const foundryClient = new FoundryClient(config);
const bot = new FoundryBot(foundryClient);

adapter.onTurnError = async (context, error) => {
  console.error(JSON.stringify({
    event: 'turn_error',
    activityId: context.activity && context.activity.id,
    conversationId: context.activity && context.activity.conversation && context.activity.conversation.id,
    error: {
      name: error.name,
      message: error.message
    }
  }));

  await context.sendActivity('The adapter hit an unexpected Bot Framework error.');
};

app.get('/', (req, res) => {
  res.status(200).json({
    name: 'foundry-bot-adapter',
    status: 'ok'
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

app.get('/ready', (req, res) => {
  res.status(200).json({
    status: 'ready',
    foundryEndpointConfigured: Boolean(config.responsesEndpoint)
  });
});

if (config.enableLocalTestEndpoints) {
  app.post('/api/test/foundry', async (req, res, next) => {
    try {
      if (config.localTestApiKey && req.get('x-test-api-key') !== config.localTestApiKey) {
        res.status(401).json({
          error: 'Invalid local test API key.'
        });
        return;
      }

      const response = await foundryClient.createResponse({
        input: req.body && req.body.input,
        activity: {
          id: 'local-test',
          channelId: 'local'
        }
      });

      res.status(200).json({
        id: response.id,
        text: response.text,
        metadataKeyCount: response.metadataKeyCount
      });
    } catch (error) {
      next(error);
    }
  });
}

app.post('/api/messages', async (req, res) => {
  await adapter.process(req, res, async (context) => {
    await bot.run(context);
  });
});

app.use((err, req, res, next) => {
  console.error(JSON.stringify({
    event: 'http_error',
    path: req.path,
    error: {
      name: err.name,
      message: err.message,
      status: err.status,
      code: err.code
    }
  }));

  if (res.headersSent) {
    next(err);
    return;
  }

  res.status(err.status || 500).json({
    error: 'Adapter request failed.',
    code: err.code || err.name || 'adapter_error',
    message: config.nodeEnv === 'production' ? undefined : err.message
  });
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`Foundry bot adapter listening on ${config.port}`);
});
