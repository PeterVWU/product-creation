const logger = require('../../config/logger');
const config = require('../../config');

class SlackService {
  constructor() {
    this.enabled = config.notifications?.slack?.enabled || false;
    this.token = config.notifications?.slack?.token;
    this.channel = config.notifications?.slack?.channel;
    this.timeout = config.notifications?.slack?.timeout || 5000;
  }

  isConfigured() {
    return this.enabled && this.token && this.channel;
  }

  async sendMessage(blocks, fallbackText) {
    if (!this.isConfigured()) {
      logger.info('Slack notifications disabled or not configured');
      return;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          channel: this.channel,
          text: fallbackText,
          blocks
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!data.ok) {
        throw new Error(`Slack API error: ${data.error}`);
      }

      logger.info('Slack notification sent successfully');
    } catch (error) {
      if (error.name === 'AbortError') {
        logger.warn('Slack notification timed out', { timeout: this.timeout });
      } else {
        logger.warn('Failed to send Slack notification', { error: error.message });
      }
    }
  }

  buildFieldsBlock(fields) {
    return {
      type: 'section',
      fields: fields.map(f => ({
        type: 'mrkdwn',
        text: `*${f.label}:* ${f.value}`
      }))
    };
  }

  async notifyMigrationStart(parentSku, childSkus = [], targetStores = []) {
    const childSkuList = childSkus.length > 0 ? childSkus.join(', ') : 'None';

    const blocks = [
      { type: 'header', text: { type: 'plain_text', text: '🚀 Product Migration Started' } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Parent SKU:* ${parentSku}\n*Child SKUs (${childSkus.length}):* ${childSkuList}`
        }
      }
    ];

    if (targetStores.length > 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Target Stores:* ${targetStores.join(', ')}` }
      });
    }

    await this.sendMessage(blocks, `🚀 Migration started for ${parentSku}`);
  }

  async notifyPriceSyncStart(sku, variantCount, targetStores = []) {
    const blocks = [
      { type: 'header', text: { type: 'plain_text', text: '💰 Price Sync Started' } },
      this.buildFieldsBlock([
        { label: 'SKU', value: sku },
        { label: 'Variants', value: String(variantCount) }
      ])
    ];

    if (targetStores.length > 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Target Stores:* ${targetStores.join(', ')}` }
      });
    }

    await this.sendMessage(blocks, `💰 Price sync started for ${sku}`);
  }

  async notifyPriceSyncEnd(syncContext) {
    const { sku, success, variantCount, prices, errors, targetStores, duration } = syncContext;

    const statusText = success ? 'Completed Successfully' : 'Failed';
    const header = success ? '✅ Price Sync Completed' : '❌ Price Sync Failed';

    const blocks = [
      { type: 'header', text: { type: 'plain_text', text: header } },
      this.buildFieldsBlock([
        { label: 'SKU', value: sku },
        { label: 'Status', value: statusText },
        { label: 'Duration', value: `${duration}ms` }
      ])
    ];

    if (success && prices && prices.length > 0) {
      const priceList = prices.slice(0, 10).map(p => `${p.sku}: $${p.price}`).join(', ');
      const suffix = prices.length > 10 ? ` (+${prices.length - 10} more)` : '';
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Updated Prices:* ${priceList}${suffix}` }
      });
    }

    if (success) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Variants Updated:* ${variantCount}` }
      });
    } else if (errors && errors.length > 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Error:* ${errors[errors.length - 1].message}` }
      });
    }

    if (targetStores && targetStores.length > 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Target Stores:* ${targetStores.join(', ')}` }
      });
    }

    await this.sendMessage(blocks, `${success ? '✅' : '❌'} Price sync ${statusText.toLowerCase()} for ${sku}`);
  }

  async notifyProductUpdateStart(sku, targetStores = []) {
    const blocks = [
      { type: 'header', text: { type: 'plain_text', text: '✏️ Product Fields Update Started' } },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*SKU:* ${sku}` }
      }
    ];

    if (targetStores.length > 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Target Stores:* ${targetStores.join(', ')}` }
      });
    }

    await this.sendMessage(blocks, `✏️ Product update started for ${sku}`);
  }

  async notifyProductUpdateEnd({ sku, success, errors = [], targetStores = [], duration }) {
    const statusText = success ? 'Completed Successfully' : 'Failed';
    const header = success ? '✅ Product Fields Update Completed' : '❌ Product Fields Update Failed';

    const blocks = [
      { type: 'header', text: { type: 'plain_text', text: header } },
      this.buildFieldsBlock([
        { label: 'SKU', value: sku },
        { label: 'Status', value: statusText },
        { label: 'Duration', value: `${duration}ms` }
      ])
    ];

    if (!success && errors && errors.length > 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Error:* ${errors[errors.length - 1].message}` }
      });
    }

    if (targetStores.length > 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Target Stores:* ${targetStores.join(', ')}` }
      });
    }

    await this.sendMessage(blocks, `${success ? '✅' : '❌'} Product update ${statusText.toLowerCase()} for ${sku}`);
  }

  async notifyMigrationEnd(migrationContext) {
    const { sku, success, summary, errors, productId, targetStores, targetMagentoStores, storeResults, shopifyProductUrl } = migrationContext;
    const resolvedTargetStores = targetStores || targetMagentoStores || [];

    const statusText = success ? 'Completed Successfully' : 'Failed';
    const header = success ? '✅ Migration Completed' : '❌ Migration Failed';

    const blocks = [
      { type: 'header', text: { type: 'plain_text', text: header } },
      this.buildFieldsBlock([
        { label: 'SKU', value: sku },
        { label: 'Status', value: statusText },
        { label: 'Duration', value: `${summary.totalDuration}ms` }
      ])
    ];

    if (success) {
      const childCount = summary.childrenMigrated ?? summary.variantsMigrated ?? 0;
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Children Migrated:* ${childCount}` }
      });
    } else {
      const errorMessage = errors && errors.length > 0
        ? errors[errors.length - 1].message
        : 'Unknown error';
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Error:* ${errorMessage}` }
      });
    }

    if (resolvedTargetStores.length > 0) {
      const succeeded = summary.storesSucceeded || summary.instancesSucceeded || 0;
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Target Stores:* ${resolvedTargetStores.join(', ')}\n*Stores:* ${succeeded}/${resolvedTargetStores.length} succeeded`
        }
      });
    }

    if (shopifyProductUrl) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `<${shopifyProductUrl}|View Product Page>`
        }
      });
    }

    await this.sendMessage(blocks, `${success ? '✅' : '❌'} Migration ${statusText.toLowerCase()} for ${sku}`);
  }
}

module.exports = SlackService;
