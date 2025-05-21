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
  };

  config.aiModel = {
    apiKey: process.env.DEEPSEEK_API_KEY,
    apiUrl: process.env.DEEPSEEK_URL,
    // 新增：服务器等待AI同步返回的最长时间 (略小于15秒)
    syncAttemptTimeoutMs: 14500, // 例如14.5秒
    // AI服务自身请求的超时 (用于后台异步调用，可以更长)
    backgroundRequestTimeoutMs: 120000, // 例如2分钟
    // 缓存相关
    cacheTTLSeconds: 300, // AI结果在缓存中的存活时间 (5分钟)
  };

  config.bodyParser = {
    enableTypes: ['json', 'form', 'text'],
    extendTypes: {
      text: ['application/xml'],
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
