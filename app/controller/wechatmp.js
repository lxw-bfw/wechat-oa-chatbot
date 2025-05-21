'use strict';

const Controller = require('egg').Controller;
const crypto = require('crypto'); // 引入 Node.js 内置的 crypto 模块，用于加密

class WechatmpController extends Controller {
  async verify() {
    const { ctx, app } = this;
    const logger = ctx.logger;

    const { signature, timestamp, nonce, echostr } = ctx.query;
    if (!signature || !timestamp || !nonce || !echostr) {
      logger.warn('[WechatmpController verify]:WeChat verification missing parameters.');
      ctx.body = 'Missing parameters';
      ctx.status = 400; // Bad Request
      return;
    }
    logger.info(
      `[WechatmpController verify]:Received Wechat verification params: signature=${signature}, timestamp=${timestamp}, nonce=${nonce}, echostr=${echostr}`
    );

    const token = app.config.wechat.token;
    const arr = [token, timestamp, nonce];
    arr.sort(); // 按照微信官方文档，对这个几个字段进行默认字典排序

    const sortedString = arr.join(''); // 将数组元素无缝拼接为字符粗

    const sha1 = crypto.createHash('sha1');
    // 更新哈希对象的内容
    sha1.update(sortedString);
    // 计算哈希值，并以十六进制字符串形式输出
    const calculatedSignature = sha1.digest('hex');

    logger.info(
      `[WechatmpController verify]:Calculated signature: ${calculatedSignature}, Received signature: ${signature}`
    );

    // 6. 将加密后的字符串与signature进行对比
    if (calculatedSignature === signature) {
      // 7. 如果一致，原样返回echostr
      logger.info('[WechatmpController verify]:WeChat verification successful.');
      ctx.body = echostr; // 将echostr作为响应体返回给微信服务器
      ctx.status = 200; // 200 OK
    } else {
      // 如果不一致，则验证失败
      logger.warn('[WechatmpController verify]:WeChat verification failed: signature mismatch.');
      ctx.body = 'Verification Failed';
      ctx.status = 401; // 401 Unauthorized, 表示验证失败
    }
  }
}

module.exports = WechatmpController;
