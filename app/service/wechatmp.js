'use strict';

const Service = require('egg').Service;
const { USERMESSAGECACHE } = require('../utils/CacheEntry');

class WechatmpService extends Service {
  /**
   * 入口：处理接收到的文本消息
   * 核心在处理微信公众号被动回复接口的五秒限制、协调和利用好用户的一次消息生命周期下的三次重试机会，确保尽快和友好地把等待AI形成完整的回复返回给用户
   * 业务代码核心在：同一消息生命周期下的多轮请求管理、状态管理、维护不同状态事件触发的异步缓存更新和重置，尽量减少缓存竞态，避免同一消息生命周期下重复触发AI接口调用，利用好三次重试机会来缓存AI的回复，保证三次重试机会下尽快返回给用户消息，或者是错过机会后，直接返回提示，让用户输入任意文字后继续返回AI的回复
   * @param {object} messageData - 解析后的微信消息对象，包含FromUserName, ToUserName, Content等
   * @return {Promise<string>} 构建好的回复XML字符串
   */
  async processTextMessage(messageData) {
    const { ctx, app } = this;
    const { replyTimeout, totalReplyTimeout, replyTimeoutTips } = app.config.wechat;
    const { cacheTTLSeconds } = app.config.aiModel;
    const logger = ctx.logger;
    const currentTime = new Date().getTime();
    const { FromUserName: fromUser, ToUserName: toUser, Content: userPrompt } = messageData;
    let userMessageCached = await ctx.helper.getFromCache(fromUser);
    // USERMESSAGECACHE()包裹一层函数返回初始用户消息数据，确保每个用户都有独立的缓存数据，避免引用问题
    userMessageCached = userMessageCached || USERMESSAGECACHE();
    logger.info('用户当前请求下的消息缓存', userMessageCached);
    // await ctx.helper.deleteFromCache(fromUser);
    // return;

    if (userMessageCached.status === 0) {
      userMessageCached.status = 1;
      userMessageCached.firstTimestamp = currentTime;
      await ctx.helper.setToCache(fromUser, userMessageCached, cacheTTLSeconds);
      const replyXml = await this.processAccessAiMessage(fromUser, toUser, userPrompt);
      if (new Date().getTime() - currentTime < replyTimeout) {
        await ctx.helper.deleteFromCache(fromUser);
        return replyXml;
      }
      //   await new Promise(resolve => setTimeout(resolve, 1000));
      userMessageCached = await ctx.helper.getFromCache(fromUser);
      userMessageCached.msgContent = replyXml;
      userMessageCached.originalQuery = userPrompt;
      await ctx.helper.setToCache(fromUser, userMessageCached, cacheTTLSeconds);
    } else if (userMessageCached.status === 1 || userMessageCached.status === 2) {
      const replyXml = await this.pollForAiResponse(
        fromUser,
        toUser,
        replyTimeout,
        totalReplyTimeout,
        replyTimeoutTips,
        cacheTTLSeconds
      );
      if (replyXml) {
        return replyXml;
      }
    } else if (userMessageCached.status === 3) {
      // todo: 处理分段消息
    }
  }

  /**
   * 调用AI大模型服务获取回复，并格式化为微信XML。
   * @param {string} fromUser - 发送方OpenID (用于XML)
   * @param {string} toUser - 接收方公众号原始ID (用于XML)
   * @param {string} userPrompt - 用户输入文本
   * @return {Promise<string>} AI回复的XML字符串
   */
  async processAccessAiMessage(fromUser, toUser, userPrompt) {
    const { ctx, service } = this;
    const logger = ctx.logger;
    try {
      logger.info('开始调用大模型接口', '用户id', fromUser, '用户输入', userPrompt);
      const replyContent = await service.aiModel.getAiModelByTextPrompt(userPrompt);
      logger.info('调用结束', '回答内容', replyContent);
      return ctx.helper.formatTextReply(
        fromUser,
        toUser,
        replyContent || '我还在学习中，暂时无法回答您的问题。'
      );
    } catch (error) {
      // TODO: 关键点：本轮没有超过微信官方限制时间下抛出的错误
      logger.error('[WechatmpService processTextMessage]:大模型接口调用失败:', error);
      return ctx.helper.formatTextReply(
        fromUser,
        toUser,
        '实在抱歉，AI助手出了点意外，突然睡着了，请稍等一会再试试！'
      );
    }
  }

  /**
   * 轮询缓存以获取AI的最终回复，或在超时后返回相应提示。
   * @param {string} fromUser - 用户OpenID
   * @param {string} toUser - 公众号原始ID
   * @param {number} replyTimeout - 单次请求下轮询的最大等待时间
   * @param {number} totalReplyTimeout - 从首次请求开始计算的总超时阈值 (略小于15s)
   * @param {string} replyTimeoutTips - 总超时后给用户的提示文本
   * @param {number} cacheTTLSeconds - redis缓存用户消息的TTL
   * @return {Promise<string|null>} AI回复的XML，或总超时提示XML，或null（表示本次轮询超时但总时间未到）
   */
  async pollForAiResponse(
    fromUser,
    toUser,
    replyTimeout,
    totalReplyTimeout,
    replyTimeoutTips,
    cacheTTLSeconds
  ) {
    const { ctx } = this;
    const logger = ctx.logger;
    let elapsedTime = 0;
    let userMessageCached = null;
    // 确保最终返回内容后，删除或重置缓存后，不要触发微信重试接口导致缓存被错误覆盖。
    while (elapsedTime <= replyTimeout) {
      userMessageCached = await ctx.helper.getFromCache(fromUser);
      if (userMessageCached && userMessageCached.msgContent) {
        await ctx.helper.deleteFromCache(fromUser);
        return userMessageCached.msgContent;
      }
      if (elapsedTime === replyTimeout) {
        const totalElapsedTime = new Date().getTime() - userMessageCached.firstTimestamp;
        if (totalElapsedTime >= totalReplyTimeout) {
          userMessageCached = await ctx.helper.getFromCache(fromUser);
          userMessageCached.status = 2;
          userMessageCached.firstTimestamp = new Date().getTime();
          await ctx.helper.setToCache(fromUser, userMessageCached, cacheTTLSeconds);
          return ctx.helper.formatTextReply(fromUser, toUser, replyTimeoutTips);
        }
        return null;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
      elapsedTime = elapsedTime + 1000;
      logger.info('等待中，已过时间', elapsedTime);
    }
  }
}

module.exports = WechatmpService;
