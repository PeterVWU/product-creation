const logger = require('../../config/logger');
const config = require('../../config');

class GoogleChatService {
  constructor() {
    this.enabled = config.notifications?.googleChat?.enabled || false;
    this.webhookUrl = config.notifications?.googleChat?.webhookUrl;
    this.timeout = config.notifications?.googleChat?.timeout || 5000;
    // Admin URL is no longer tied to a single target instance
    // Product admin links are omitted from notifications with multi-instance setup
  }

  isConfigured() {
    return this.enabled && this.webhookUrl;
  }

  buildProductAdminUrl(productId) {
    // No single admin URL with multi-instance setup
    return null;
  }

  async sendMessage(card) {
    if (!this.isConfigured()) {
      logger.info('Google Chat notifications disabled or not configured');
      return;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(card),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      logger.info('Google Chat notification sent successfully');
    } catch (error) {
      if (error.name === 'AbortError') {
        logger.warn('Google Chat notification timed out', { timeout: this.timeout });
      } else {
        logger.warn('Failed to send Google Chat notification', { error: error.message });
      }
    }
  }

  async notifyMigrationStart(parentSku, childSkus = [], targetStores = []) {
    const childSkuList = childSkus.length > 0
      ? childSkus.join(', ')
      : 'None';

    const widgets = [
      {
        decoratedText: {
          text: `<b>Parent SKU:</b> ${parentSku}`
        }
      },
      {
        decoratedText: {
          text: `<b>Child SKUs (${childSkus.length}):</b> ${childSkuList}`
        }
      }
    ];

    if (targetStores.length > 0) {
      widgets.push({
        decoratedText: {
          text: `<b>Target Stores:</b> ${targetStores.join(', ')}`
        }
      });
    }

    const card = {
      cardsV2: [{
        cardId: 'migration-start',
        card: {
          sections: [{
            header: '🚀 Product Migration Started',
            widgets
          }]
        }
      }]
    };

    await this.sendMessage(card);
  }

  async notifyPriceSyncStart(sku, variantCount, targetStores = []) {
    const widgets = [
      {
        decoratedText: {
          text: `<b>SKU:</b> ${sku}`
        }
      },
      {
        decoratedText: {
          text: `<b>Variants:</b> ${variantCount}`
        }
      }
    ];

    if (targetStores.length > 0) {
      widgets.push({
        decoratedText: {
          text: `<b>Target Stores:</b> ${targetStores.join(', ')}`
        }
      });
    }

    const card = {
      cardsV2: [{
        cardId: 'price-sync-start',
        card: {
          sections: [{
            header: '💰 Price Sync Started',
            widgets
          }]
        }
      }]
    };

    await this.sendMessage(card);
  }

  async notifyPriceSyncEnd(syncContext) {
    const { sku, success, variantCount, prices, errors, targetStores, duration } = syncContext;

    const statusText = success ? 'Completed Successfully' : 'Failed';
    const sectionHeader = success ? '✅ Price Sync Completed' : '❌ Price Sync Failed';

    const widgets = [
      {
        decoratedText: {
          text: `<b>SKU:</b> ${sku}`
        }
      },
      {
        decoratedText: {
          text: `<b>Status:</b> ${statusText}`
        }
      },
      {
        decoratedText: {
          text: `<b>Duration:</b> ${duration}ms`
        }
      }
    ];

    if (success && prices && prices.length > 0) {
      const priceList = prices.slice(0, 10).map(p => `${p.sku}: $${p.price}`).join(', ');
      const suffix = prices.length > 10 ? ` (+${prices.length - 10} more)` : '';
      widgets.push({
        decoratedText: {
          text: `<b>Updated Prices:</b> ${priceList}${suffix}`
        }
      });
    }

    if (success) {
      widgets.push({
        decoratedText: {
          text: `<b>Variants Updated:</b> ${variantCount}`
        }
      });
    } else if (errors && errors.length > 0) {
      const errorMessage = errors[errors.length - 1].message;
      widgets.push({
        decoratedText: {
          text: `<b>Error:</b> ${errorMessage}`
        }
      });
    }

    if (targetStores && targetStores.length > 0) {
      widgets.push({
        decoratedText: {
          text: `<b>Target Stores:</b> ${targetStores.join(', ')}`
        }
      });
    }

    const card = {
      cardsV2: [{
        cardId: 'price-sync-end',
        card: {
          sections: [{
            header: sectionHeader,
            widgets
          }]
        }
      }]
    };

    await this.sendMessage(card);
  }

  async notifyMigrationEnd(migrationContext) {
    const { sku, success, summary, errors, productId, targetStores, targetMagentoStores, storeResults, shopifyProductUrl } = migrationContext;
    const resolvedTargetStores = targetStores || targetMagentoStores || [];

    const statusText = success ? 'Completed Successfully' : 'Failed';
    const sectionHeader = success ? '✅ Migration Completed' : '❌ Migration Failed';

    const widgets = [
      {
        decoratedText: {
          text: `<b>SKU:</b> ${sku}`
        }
      },
      {
        decoratedText: {
          text: `<b>Status:</b> ${statusText}`
        }
      },
      {
        decoratedText: {
          text: `<b>Duration:</b> ${summary.totalDuration}ms`
        }
      }
    ];

    if (success) {
      widgets.push({
        decoratedText: {
          text: `<b>Children Migrated:</b> ${summary.childrenMigrated}`
        }
      });
    } else {
      const errorMessage = errors.length > 0
        ? errors[errors.length - 1].message
        : 'Unknown error';
      widgets.push({
        decoratedText: {
          text: `<b>Error:</b> ${errorMessage}`
        }
      });
    }

    if (resolvedTargetStores.length > 0) {
      widgets.push({
        decoratedText: {
          text: `<b>Target Stores:</b> ${resolvedTargetStores.join(', ')}`
        }
      });

      const succeeded = summary.storesSucceeded || summary.instancesSucceeded || 0;
      widgets.push({
        decoratedText: {
          text: `<b>Stores:</b> ${succeeded}/${resolvedTargetStores.length} succeeded`
        }
      });
    }

    const adminUrl = productId ? this.buildProductAdminUrl(productId) : null;
    if (adminUrl) {
      widgets.push({
        buttonList: {
          buttons: [{
            text: 'View Product in Magento',
            type: 'OUTLINED',
            onClick: {
              openLink: {
                url: adminUrl
              }
            }
          }]
        }
      });
    }

    if (shopifyProductUrl) {
      widgets.push({
        buttonList: {
          buttons: [{
            text: 'View Product in Shopify',
            type: 'OUTLINED',
            onClick: {
              openLink: {
                url: shopifyProductUrl
              }
            }
          }]
        }
      });
    }

    const card = {
      cardsV2: [{
        cardId: 'migration-end',
        card: {
          sections: [{
            header: sectionHeader,
            widgets: widgets
          }]
        }
      }]
    };

    await this.sendMessage(card);
  }
}

module.exports = GoogleChatService;
