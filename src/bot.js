const { ActivityHandler, TurnContext } = require('botbuilder');
const { FoundryClientError } = require('./foundryClient');

function stripRecipientMention(activity) {
  const withoutMention = TurnContext.removeRecipientMention(activity);
  return (withoutMention || activity.text || '').trim();
}

function sanitizeError(error) {
  return {
    name: error.name,
    message: error.message,
    status: error.status,
    code: error.code,
    responseId: error.responseId
  };
}

class FoundryBot extends ActivityHandler {
  constructor(foundryClient) {
    super();
    this.foundryClient = foundryClient;

    this.onMessage(async (context, next) => {
      const text = stripRecipientMention(context.activity);
      if (!text) {
        await context.sendActivity('Send a message and I will forward it to the Foundry agent.');
        await next();
        return;
      }

      try {
        const response = await this.foundryClient.createResponse({
          input: text,
          activity: context.activity
        });

        console.log(JSON.stringify({
          event: 'foundry_response',
          activityId: context.activity.id,
          conversationId: context.activity.conversation && context.activity.conversation.id,
          responseId: response.id,
          metadataKeyCount: response.metadataKeyCount
        }));

        await context.sendActivity(response.text || 'Foundry returned a response without text content.');
      } catch (error) {
        console.error(JSON.stringify({
          event: 'foundry_error',
          activityId: context.activity.id,
          conversationId: context.activity.conversation && context.activity.conversation.id,
          error: sanitizeError(error)
        }));

        if (error instanceof FoundryClientError) {
          await context.sendActivity(
            `The adapter reached Foundry, but Foundry returned an error: ${error.message}`
          );
        } else {
          await context.sendActivity('The adapter failed before it could get a response from Foundry.');
        }
      }

      await next();
    });

    this.onMembersAdded(async (context, next) => {
      const membersAdded = context.activity.membersAdded || [];
      for (const member of membersAdded) {
        if (member.id !== context.activity.recipient.id) {
          await context.sendActivity('Foundry adapter is ready. Send a message to test the agent.');
        }
      }

      await next();
    });
  }
}

module.exports = {
  FoundryBot,
  sanitizeError,
  stripRecipientMention
};
