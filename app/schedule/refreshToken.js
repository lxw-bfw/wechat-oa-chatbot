// app/schedule/refresh_token.js
const Subscription = require('egg').Subscription;

class RefreshTokenSchedule extends Subscription {
  static get schedule() {
    return {
      interval: '90m',
      type: 'worker', // 单一worker进程执行。
      // 配合 WechatTokenService 中的分布式锁，即使 type: 'all' 也能保证只有一个执行刷新。
      // 但 'worker' 更节能。
      immediate: true,
      disable: false,
    };
  }

  async subscribe() {
    const { ctx, service } = this;
    const scheduleLogger = ctx.getLogger('scheduleLogger');
    try {
      scheduleLogger.info('[RefreshTokenSchedule] Starting scheduled token refresh.');

      await service.wechatToken.refreshToken();

      scheduleLogger.info('[RefreshTokenSchedule] Scheduled token refresh completed successfully.');
    } catch (error) {
      const errorMsg = error.stack || error.message;
      // 定时任务失败，
      scheduleLogger.error('[RefreshTokenSchedule] Scheduled token refresh failed:', errorMsg);
      // TODO: 增加告警提醒
    }
  }
}

module.exports = RefreshTokenSchedule;
