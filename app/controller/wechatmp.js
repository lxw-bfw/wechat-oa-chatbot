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
      `Received Wechat verification params: signature=${signature}, timestamp=${timestamp}, nonce=${nonce}, echostr=${echostr}`
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

    logger.info(`Calculated signature: ${calculatedSignature}, Received signature: ${signature}`);

    // 6. 将加密后的字符串与signature进行对比
    if (calculatedSignature === signature) {
      // 7. 如果一致，原样返回echostr
      logger.info('WeChat verification successful...');
      ctx.body = echostr; // 将echostr作为响应体返回给微信服务器
      ctx.status = 200; // 200 OK
    } else {
      // 如果不一致，则验证失败
      logger.warn('[WechatmpController verify]:WeChat verification failed: signature mismatch.');
      ctx.body = 'Verification Failed';
      ctx.status = 401; // 401 Unauthorized, 表示验证失败
    }
  }
  async handleMessage() {
    const { ctx, service, app } = this;
    const { wechat } = app.config;
    const logger = ctx.logger;

    // await new Promise(resolve => setTimeout(resolve, 6000));

    // 1. 解析XML 消息
    let messageData;
    if (ctx.request.type === 'text/xml' || ctx.request.type === 'application/xml') {
      logger.info('Received XML request body:', ctx.request.body);
      try {
        messageData = await ctx.helper.parseXml(ctx.request.body);
        logger.info('Parsed XML message:', messageData);
      } catch (e) {
        logger.error('[WechatmpController handleMessage]:Failed to parse XML request body:', e);
        ctx.body = 'Invalid XML';
        ctx.status = 400;
        return;
      }
    } else {
      logger.warn('[WechatmpController handleMessage]:Received non-XML request:', ctx.request.type);
      ctx.body = 'Please send XML';
      ctx.status = 400;
      return;
    }

    if (!messageData || !messageData.MsgType) {
      logger.error(
        '[WechatmpController handleMessage]:Parsed message data is invalid or missing MsgType:',
        messageData
      );
      ctx.body = 'Invalid message structure';
      ctx.status = 400;
      return;
    }

    // 2. 根据消息类型处理
    let replyXml = '';
    switch (messageData.MsgType) {
      case 'text':
        logger.info(
          `Received text message from ${messageData.FromUserName}: ${messageData.Content}`
        );
        replyXml = await service.wechatmp.processTextMessage(messageData);
        break;
      case 'event':
        logger.info(`Received event: ${messageData.Event} from ${messageData.FromUserName}`);
        if (messageData.Event === 'subscribe') {
          replyXml = ctx.helper.formatTextReply(
            messageData.FromUserName,
            messageData.ToUserName,
            wechat.subscribeMsg
          );
        } else {
          // 对于其他事件，暂时不回复（处理）
          replyXml = 'success'; // 回复 success，让微信官方知道此次消息已经接收到了
        }
        break;
      // TODO: 处理其他消息类型如 image, voice, etc.
      default:
        logger.info(
          `Received unhandled message type: ${messageData.MsgType} from ${messageData.FromUserName}`
        );
        replyXml = ctx.helper.formatTextReply(
          messageData.ToUserName,
          messageData.FromUserName,
          '我暂时还不能理解这种类型的消息哦。'
        );
        break;
    }

    // 3. 回复微信服务器
    if (replyXml === 'success') {
      // 'success'字符串通常用于告知微信服务器已成功接收事件等，无需回复具体内容
      ctx.body = 'success';
    } else if (replyXml) {
      ctx.set('Content-Type', 'application/xml');
      ctx.body = replyXml;
    } else {
      // 不做回复
    }
  }

  async searchUserList() {
    const { ctx } = this;
    try {
      const result = await ctx.service.wechatApi.getUserList();
      ctx.body = result;
    } catch (error) {
      ctx.status = 500;
      ctx.body = {
        error: '服务器错误，查询失败',
      };
    }
  }
}

module.exports = WechatmpController;
