// app/service/wechatApi.js
const Service = require('egg').Service;
const fs = require('fs');

class WechatApiService extends Service {
  async request(apiUrl, params = {}, method = 'GET', retry = false, responseType = 'json') {
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
      timeout: 15000, // 对于文件下载，超时可以适当延长
      method: method.toUpperCase(),
    };
    if (responseType === 'stream') {
      requestOptions.streaming = true;
    } else if (responseType === 'buffer') {
      // ctx.curl 默认会将非JSON响应体作为Buffer，但最好明确
      // 如果 dataType 不是 json，urllib 会尝试将结果转为 Buffer 或 string
    } else {
      // 默认为 json
      requestOptions.dataType = 'json';
    }

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

      // 对于流式响应，result.res 是可读流 (ReadableStream)
      if (responseType === 'stream') {
        // 检查响应头中是否有错误信息 (微信有时在出错时仍返回200，但头部或内容不同)
        const contentType = result.headers['content-type'];
        if (contentType && contentType.includes('application/json')) {
          return new Promise((resolve, reject) => {
            let errorBody = '';
            result.res.on('data', chunk => {
              errorBody += chunk;
            });
            result.res.on('end', () => {
              try {
                const errorData = JSON.parse(errorBody);
                wechatLogger.warn(
                  `[WechatApiService] WeChat API Error (in stream, parsed as JSON): code=${errorData.errcode}, msg=${errorData.errmsg}, url=${fullUrl}`
                );
                if ([40001, 40014, 42001, 42007].includes(errorData.errcode) && !retry) {
                  service.wechatToken
                    .forceRefreshToken()
                    .then(() => {
                      // 注意：这里的重试调用需要更复杂的处理，因为原始 request 是 async 的
                      // 简单起见，这里直接抛出错误，让上层处理重试，或者 getTempMedia 自己处理
                      reject(
                        new Error(
                          `Access token expired/invalid, refresh and retry needed. Original error: ${errorData.errmsg} (code: ${errorData.errcode})`
                        )
                      );
                    })
                    .catch(reject);
                } else {
                  reject(
                    new Error(`WeChat API Error: ${errorData.errmsg} (code: ${errorData.errcode})`)
                  );
                }
              } catch (parseError) {
                wechatLogger.error(
                  `[WechatApiService] Failed to parse error JSON from stream for ${fullUrl}. Body: ${errorBody}`
                );
                reject(new Error('Received JSON error in stream, but failed to parse it.'));
              }
            });
            result.res.on('error', streamError => {
              wechatLogger.error(
                `[WechatApiService] Stream error while reading error response from ${fullUrl}:`,
                streamError
              );
              reject(streamError);
            });
          });
        }
        // 成功获取流
        wechatLogger.info(
          `[WechatApiService] WeChat API Response Success (Stream) for ${fullUrl}. Headers:`,
          result.headers
        );
        return result.res; // 直接返回可读流对象
      }

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
          return this.request(apiUrl, params, method, true, responseType);
        }

        throw new Error(`WeChat API Error: ${responseData.errmsg} (code: ${responseData.errcode})`);
      }

      // 如果 responseType 是 'buffer' 但 dataType 可能是 'text' 或其他导致 result.data 不是 Buffer
      // 需要确保返回的是 Buffer。 ctx.curl 在 dataType 不是 json 时，data 默认是 Buffer。
      if (responseType === 'buffer' && !Buffer.isBuffer(responseData)) {
        wechatLogger.warn(
          `[WechatApiService] Expected buffer response for ${fullUrl} but got ${typeof responseData}. Content: ${String(responseData).substring(0, 100)}...`
        );
      }

      wechatLogger.info(`[WechatApiService] WeChat API Response Success for ${fullUrl}.`);
      return responseData;
    } catch (err) {
      const errorMsg = err.stack || err.message;
      wechatLogger.error(`[WechatApiService] Failed to call WeChat API ${fullUrl}:`, errorMsg);
      // TODO: 网络错误、请求超时或内部其他错误等，增加告警提醒

      throw err;
    }
  }

  /**
   * 获取临时素材接口 (下载文件)
   * @param {string} MediaId 媒体文件ID
   * @param {string} outputFilePath 文件保存的完整路径
   * @return {Promise<boolean>} true if download successful, false otherwise
   */
  async getTempMediaAndSave(MediaId, outputFilePath) {
    const { ctx, wechatLogger = ctx.getLogger('wechatLogger') } = this; // 添加 wechatLogger
    if (!MediaId) {
      wechatLogger.error('[WechatApiService getTempMedia] MediaId is required.');
      throw new Error('MediaId is required');
    }
    if (!outputFilePath) {
      wechatLogger.error('[WechatApiService getTempMedia] outputFilePath is required.');
      throw new Error('outputFilePath is required');
    }

    const apiUrl = 'https://api.weixin.qq.com/cgi-bin/media/get';
    const params = { media_id: MediaId };

    try {
      const readableStream = await this.request(apiUrl, params, 'GET', false, 'stream');

      const writer = fs.createWriteStream(outputFilePath);
      readableStream.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          wechatLogger.info(
            `[WechatApiService getTempMedia] Media ${MediaId} downloaded successfully to ${outputFilePath}`
          );
          resolve(true);
        });
        writer.on('error', err => {
          wechatLogger.error(
            `[WechatApiService getTempMedia] Error writing media ${MediaId} to file ${outputFilePath}:`,
            err
          );

          reject(err); // 将原始流写入错误传递出去
        });
        readableStream.on('error', streamErr => {
          // 监听可读流本身的错误
          wechatLogger.error(
            `[WechatApiService getTempMedia] ReadableStream error for media ${MediaId}:`,
            streamErr
          );
          writer.close();

          reject(streamErr);
        });
      });
    } catch (error) {
      wechatLogger.error(
        `[WechatApiService getTempMedia] Failed to get media ${MediaId} due to request error:`,
        error.message
      );
      return false; // 下载失败
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
