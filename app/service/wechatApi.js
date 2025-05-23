// app/service/wechatApi.js
const Service = require('egg').Service;

class WechatApiService extends Service {
  async request(apiUrl, params = {}, method = 'GET', retry = false) {
    const { ctx, service } = this;
    let accessToken;
    const wechatLogger = ctx.getLogger('wechatLogger');

    try {
      accessToken = await service.wechatToken.getAccessToken();
      if (!accessToken) {
        // 确保获取到token
        wechatLogger.error(
          '[WechatApiService] Failed to get access token for API request. Token is null/undefined.'
        );
        // TODO:可以增加告警服务

        throw new Error('获取AccessToken失败');
      }
    } catch (tokenError) {
      const errorMsg = tokenError.stack || tokenError.message;
      wechatLogger.error(
        '[WechatApiService]  error getting access token for API request:',
        errorMsg
      );
      // TODO:可以增加告警服务
      throw new Error(`未能成功获取到AccessToken: ${tokenError.message}`);
    }

    let fullUrl = apiUrl;
    const requestOptions = {
      dataType: 'json',
      timeout: 10000,
    };

    if (method.toUpperCase() === 'GET') {
      const queryParams = new URLSearchParams(params);
      queryParams.append('access_token', accessToken);
      fullUrl = `${apiUrl}?${queryParams.toString()}`;
    } else if (method.toUpperCase() === 'POST') {
      fullUrl = `${apiUrl}?access_token=${accessToken}`;
      requestOptions.method = 'POST';
      requestOptions.contentType = 'json';
      requestOptions.data = params;
    } else {
      wechatLogger.error(`[WechatApiService] Unsupported HTTP method: ${method}`);
      throw new Error(`Unsupported HTTP method: ${method}`);
    }

    wechatLogger.info(`[WechatApiService] Requesting WeChat API: ${method} ${fullUrl}`);
    if (method.toUpperCase() === 'POST') {
      wechatLogger.info(`[WechatApiService] POST Data: ${JSON.stringify(params)}`);
    }

    try {
      const result = await ctx.curl(fullUrl, requestOptions);
      const responseData = result.data;

      if (responseData && responseData.errcode && responseData.errcode !== 0) {
        // 检查errcode是否存在且不为0
        wechatLogger.warn(
          `[WechatApiService] WeChat API Error: code=${responseData.errcode}, msg=${responseData.errmsg}, url=${fullUrl}, response: ${JSON.stringify(responseData)}`
        );
        // 特定错误码：access_token无效或过期
        if ([40001, 40014, 42001, 42007].includes(responseData.errcode) && !retry) {
          wechatLogger.warn('[WechatApiService] access_token无效或过期，尝试刷新Token并重试请求');
          await service.wechatToken.forceRefreshToken();
          return this.request(apiUrl, params, method, true);
        }

        throw new Error(`WeChat API Error: ${responseData.errmsg} (code: ${responseData.errcode})`);
      }

      wechatLogger.info(`[WechatApiService] WeChat API Response Success for ${fullUrl}.`);
      return responseData;
    } catch (err) {
      // 网络错误或其他ctx.curl抛出的错误
      const errorMsg = err.stack || err.message;
      wechatLogger.error(`[WechatApiService] Failed to call WeChat API ${fullUrl}:`, errorMsg);
      // TODO: 网络错误或请求超时等，也应该告警

      throw err;
    }
  }

  async getUserList(nextOpenid = '') {
    const apiUrl = 'https://api.weixin.qq.com/cgi-bin/user/get';
    const params = {};
    if (nextOpenid) {
      params.next_openid = nextOpenid;
    }
    return this.request(apiUrl, params, 'GET');
  }

  async sendTemplateMessage(messageData) {
    const apiUrl = 'https://api.weixin.qq.com/cgi-bin/message/template/send';
    return this.request(apiUrl, messageData, 'POST');
  }
}

module.exports = WechatApiService;
