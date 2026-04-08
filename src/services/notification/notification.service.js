const GoogleChatService = require('./google-chat.service');
const SlackService = require('./slack.service');
const logger = require('../../config/logger');

class NotificationService {
  constructor() {
    this.googleChatService = new GoogleChatService();
    this.slackService = new SlackService();
  }

  async notifyMigrationStart(parentSku, childSkus = [], targetStores = []) {
    await Promise.all([
      this.googleChatService.notifyMigrationStart(parentSku, childSkus, targetStores),
      this.slackService.notifyMigrationStart(parentSku, childSkus, targetStores)
    ]);
  }

  async notifyMigrationEnd(migrationContext) {
    await Promise.all([
      this.googleChatService.notifyMigrationEnd(migrationContext),
      this.slackService.notifyMigrationEnd(migrationContext)
    ]);
  }

  async notifyPriceSyncStart(sku, variantCount, targetStores = []) {
    await Promise.all([
      this.googleChatService.notifyPriceSyncStart(sku, variantCount, targetStores),
      this.slackService.notifyPriceSyncStart(sku, variantCount, targetStores)
    ]);
  }

  async notifyPriceSyncEnd(syncContext) {
    await Promise.all([
      this.googleChatService.notifyPriceSyncEnd(syncContext),
      this.slackService.notifyPriceSyncEnd(syncContext)
    ]);
  }

  async notifyProductUpdateStart(sku, targetStores = []) {
    await Promise.all([
      this.googleChatService.notifyProductUpdateStart(sku, targetStores),
      this.slackService.notifyProductUpdateStart(sku, targetStores)
    ]);
  }

  async notifyProductUpdateEnd(context) {
    await Promise.all([
      this.googleChatService.notifyProductUpdateEnd(context),
      this.slackService.notifyProductUpdateEnd(context)
    ]);
  }
}

module.exports = NotificationService;
