const FIELD_READERS = {
  activityId: (activity) => activity.id,
  channelId: (activity) => activity.channelId,
  conversationId: (activity) => activity.conversation && activity.conversation.id,
  fromId: (activity) => activity.from && activity.from.id,
  locale: (activity) => activity.locale,
  recipientId: (activity) => activity.recipient && activity.recipient.id,
  serviceUrl: (activity) => activity.serviceUrl,
  tenantId: (activity) => activity.channelData && activity.channelData.tenant && activity.channelData.tenant.id
};

function toMetadataValue(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed.slice(0, 512);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}

function buildAllowedMetadata(activity, allowlist, maxKeys) {
  if (!Array.isArray(allowlist) || allowlist.length === 0 || maxKeys <= 0) {
    return {};
  }

  const metadata = {};
  for (const key of allowlist) {
    if (Object.keys(metadata).length >= maxKeys) {
      break;
    }

    const reader = FIELD_READERS[key];
    if (!reader) {
      throw new Error(`Unsupported metadata allowlist key: ${key}`);
    }

    const value = toMetadataValue(reader(activity || {}));
    if (value !== undefined) {
      metadata[key] = value;
    }
  }

  return metadata;
}

module.exports = {
  FIELD_READERS,
  buildAllowedMetadata,
  toMetadataValue
};
