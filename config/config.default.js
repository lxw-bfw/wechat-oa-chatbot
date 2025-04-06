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
  // 读取EGG_SERVER_PORT环境变量
  const eggServerPort = process.env.EGG_SERVER_PORT;

  // use for cookie sign key, should change to your own and keep security
  config.keys = appInfo.name + cookieSignKey;

  // add your middleware config here
  config.middleware = [];

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
