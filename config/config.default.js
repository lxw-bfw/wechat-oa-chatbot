/* eslint valid-jsdoc: "off" */

'use strict';
const path = require('path');

/**
 * @param {Egg.EggAppInfo} appInfo app info
 */
module.exports = appInfo => {
  /**
   * built-in config
   * @type {Egg.EggAppConfig}
   **/
  const config = (exports = {});

  const envFile = `.env.${appInfo.env}`;
  require('dotenv').config({ path: path.resolve(__dirname, envFile) });

  const cookieSignKey = process.env.COOKI_SIGN_KEY;
  const eggServerPort = process.env.EGG_SERVER_PORT;

  config.keys = appInfo.name + cookieSignKey;

  config.middleware = [];

  // 微信公众号相关配置
  config.wechat = {
    token: process.env.WECHATMP_TOKEN,
    appId: process.env.WECHATMP_APPID,
    appSecret: process.env.WECHATMP_APPSECRET,
    accessTokenUrl: process.env.WECHATMP_ACCESS_TOKEN_URL,
    maxTextByteLength: 2048, // 微信文本消息最大字节长度
    replyTimeout: 4000, // 微信公众号回复超时设置
    totalReplyTimeout: 12500, // 微信公众号总超时设置
    replyTimeoutTips: process.env.WECHATMP_REPLY_TIMEOUT_TIP,
    subscribeMsg: process.env.SUBSCRIBE_MSG,
    redisTokenKey: 'wechat:access_token',
    redisTokenExpiresKey: 'wechat:access_token_expires_at',
    redisLockKey: 'lock:wechat_access_token_refresh',
    lockTimeout: 5000, // 锁的超时时间，单位毫秒 (5秒)
    tokenExpireAdvance: 300, // access_token 提前多少秒视为过期 (5分钟)
  };

  config.aiModel = {
    apiKey: process.env.DEEPSEEK_API_KEY,
    apiUrl: process.env.DEEPSEEK_URL,
    aiModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    backgroundRequestTimeoutMs: 120000,
    cacheTTLSeconds: 300, // AI生成的回复内容命中缓存后的最长缓存时间
  };

  config.bodyParser = {
    enableTypes: ['json', 'form', 'text'],
    extendTypes: {
      text: ['text/xml', 'application/xml'],
    },
  };

  config.redis = {
    client: {
      port: 6379,
      host: '127.0.0.1',
      password: 'auth',
      db: 0,
    },
  };

  // 日志模块配置
  config.customLogger = {
    scheduleLogger: {
      file: path.join(appInfo.root, 'logs', appInfo.name, 'egg-schedule.log'),
    },
    wechatLogger: {
      file: path.join(appInfo.root, 'logs', appInfo.name, 'wechat-api.log'),
    },
  };

  // 告警服务配置
  config.alerting = {
    // 企业微信机器人 | 钉钉 | 邮箱
    webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send',
    enable: false,
  };

  // 对微信官发起的post请求，禁用CSRF
  config.security = {
    csrf: {
      enable: false,
    },
  };

  // 设置端口号
  config.cluster = {
    listen: {
      port: parseInt(eggServerPort), // 修改为你需要的端口号
    },
  };

  // add your user config here
  const userConfig = {
    // myAppName: 'egg',
  };

  return {
    ...config,
    ...userConfig,
  };
};
