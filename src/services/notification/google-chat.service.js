const logger = require('../../config/logger');
const config = require('../../config');

class GoogleChatService {
  constructor() {
    this.enabled = config.notifications?.googleChat?.enabled || false;
    this.webhookUrl = config.notifications?.googleChat?.webhookUrl;
    this.timeout = config.notifications?.googleChat?.timeout || 5000;
    this.adminBaseUrl = config.target.baseUrl;
    this.adminPath = config.target?.adminPath || 'admin';
  }

  isConfigured() {
    return this.enabled && this.webhookUrl;
  }

  buildProductAdminUrl(productId) {
    return `${this.adminPath}/catalog/product/edit/id/${productId}/`;
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

  async notifyMigrationStart(parentSku, childSkus = []) {
    const childSkuList = childSkus.length > 0
      ? childSkus.join(', ')
      : 'None';

    const card = {
      cardsV2: [{
        cardId: 'migration-start',
        card: {
          sections: [{
            header: '🚀 Product Migration Started',
            widgets: [
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
            ]
          }]
        }
      }]
    };

    await this.sendMessage(card);
  }

  async notifyMigrationEnd(migrationContext) {
    const { sku, success, summary, errors, productId } = migrationContext;

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

    if (productId) {
      widgets.push({
        buttonList: {
          buttons: [{
            text: 'View Product in Magento',
            type: 'OUTLINED',
            onClick: {
              openLink: {
                url: this.buildProductAdminUrl(productId)
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
