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
    maxTextByteLength: 2048, // 微信文本消息最大字节长度
    replyTimeout: 4000, // 微信公众号回复超时设置
    totalReplyTimeout: 12500, // 微信公众号总超时设置
    replyTimeoutTips: process.env.WECHATMP_REPLY_TIMEOUT_TIP,
    subscribeMsg: process.env.SUBSCRIBE_MSG,
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
