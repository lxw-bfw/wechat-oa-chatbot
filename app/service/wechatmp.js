'use strict';

const Service = require('egg').Service;
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util'); // 用于将回调式 exec 转换为 Promise
const crypto = require('crypto');
const { USERMESSAGECACHE } = require('../utils/CacheEntry');

const execPromise = promisify(exec);

class WechatmpService extends Service {
  constructor(ctx) {
    super(ctx);
    this.publicTempDir = this.app.config.publicTempDir;
    if (!fs.existsSync(this.publicTempDir)) {
      try {
        fs.mkdirSync(this.publicTempDir, { recursive: true });
      } catch (err) {
        this.ctx.logger.error(
          `[WechatApiService] 创建临时素材目录失败，请手动创建 ${this.publicTempDir}:`,
          err
        );
      }
    }
  }
  /**
   * 入口：处理接收到的文本消息（多来源）
   * 核心在处理微信公众号被动回复接口的五秒限制、协调和利用好用户的一次消息生命周期下的三次重试机会，确保尽快和友好地把等待AI形成完整的回复返回给用户
   * 业务代码核心在：同一消息生命周期下的多轮请求管理、状态管理、维护不同状态事件触发的异步缓存更新和重置，尽量减少或避免缓存竞态发生，避免同一消息生命周期下重复触发AI接口调用，利用好三次重试机会来缓存AI的回复，保证三次重试机会下尽快返回给用户消息，或者是错过机会后，直接返回提示，让用户输入任意文字后继续返回AI的回复
   * @param {object} messageData - 解析后的微信消息对象，包含FromUserName, ToUserName, Content等
   * @param {string} type - 消息来源类型，pureText | voiceText, 默认为'pureText'
   * @param {number} deduction - 扣除上论任务处理（比如语音识别）耗时
   * @return {Promise<string>} 构建好的回复XML字符串
   */
  async processTextMessage(messageData, type = 'pureText', deduction = 0) {
    const { ctx, app } = this;
    const { totalReplyTimeout, replyTimeoutTips } = app.config.wechat;
    let { replyTimeout } = app.config.wechat;
    replyTimeout = replyTimeout - deduction;
    const { cacheTTLSeconds } = app.config.aiModel;
    const logger = ctx.logger;
    const currentTime = new Date().getTime();
    const { FromUserName: fromUser, ToUserName: toUser, Content: userPrompt } = messageData;
    let userMessageCached = await ctx.helper.getFromCache(fromUser);
    // USERMESSAGECACHE()包裹一层函数返回初始用户消息数据，确保每个用户都有独立的缓存数据，避免引用问题
    userMessageCached = userMessageCached || USERMESSAGECACHE();
    logger.info('[processTextMessage] 用户当前请求下的消息缓存', userMessageCached);
    // await ctx.helper.deleteFromCache(fromUser);
    // return;

    if (userMessageCached.status === 0) {
      userMessageCached.status = 1;
      if (type === 'pureText') {
        userMessageCached.firstTimestamp = currentTime;
      }
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

  async processVoiceMessage(messageData) {
    const voiceHandleStart = Date.now();
    const { ctx, app } = this;
    const logger = ctx.logger;
    const { FromUserName: fromUser, ToUserName: toUser } = messageData;
    const { replyTimeout, totalReplyTimeout, replyTimeoutTips } = app.config.wechat;
    let userMessageCached = await ctx.helper.getFromCache(fromUser);
    userMessageCached = userMessageCached || USERMESSAGECACHE();
    logger.info(
      '[WechatmpService processVoiceMessage] 用户当前请求下的消息缓存',
      userMessageCached
    );
    if (userMessageCached.voiceText) {
      messageData.Content = userMessageCached.voiceText;
      const replyXml = await this.processTextMessage(messageData);
      return replyXml;
    }
    if (userMessageCached.voiceStatus === 0) {
      userMessageCached.voiceStatus = 1;
      userMessageCached.firstTimestamp = voiceHandleStart;
      try {
        const voiceText = await this.analysisVoiceMessage(messageData);
        const voiceHandleUseTime = Date.now() - voiceHandleStart;
        userMessageCached.voiceText = voiceText;
        userMessageCached.voiceStatus = 0;
        await ctx.helper.setToCache(
          fromUser,
          userMessageCached,
          app.config.aiModel.cacheTTLSeconds
        );
        if (voiceHandleUseTime < replyTimeout) {
          messageData.Content = userMessageCached.voiceText;
          const replyXml = await this.processTextMessage(
            messageData,
            'voiceText',
            voiceHandleUseTime
          );
          return replyXml;
        }
      } catch (error) {
        await ctx.helper.deleteFromCache(fromUser);
        return ctx.helper.formatTextReply(
          fromUser,
          toUser,
          '实在抱歉，未能识别到您本次发送的语音，请稍后再试一试！'
        );
      }
    } else if (userMessageCached.voiceStatus === 1) {
      let elapsedTime = 0;
      while (elapsedTime <= replyTimeout) {
        userMessageCached = await ctx.helper.getFromCache(fromUser);
        if (userMessageCached && userMessageCached.voiceText) {
          messageData.Content = userMessageCached.voiceText;
          const replyXml = await this.processTextMessage(messageData, 'voiceText', elapsedTime);
          return replyXml;
        }
        if (elapsedTime === replyTimeout) {
          const totalElapsedTime = new Date().getTime() - userMessageCached.firstTimestamp;
          if (totalElapsedTime >= totalReplyTimeout) {
            userMessageCached = await ctx.helper.getFromCache(fromUser);
            userMessageCached.firstTimestamp = new Date().getTime();
            await ctx.helper.setToCache(
              fromUser,
              userMessageCached,
              app.config.aiModel.cacheTTLSeconds
            );
            return ctx.helper.formatTextReply(fromUser, toUser, replyTimeoutTips);
          }
          return null;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
        elapsedTime = elapsedTime + 1000;
        logger.info('[WechatmpService processVoiceMessage] 等待中，已过时间', elapsedTime);
      }
    }
  }
  async analysisVoiceMessage(messageData) {
    const { ctx } = this;
    const rawAudioFilePath = await this.downAmrVoice(messageData);
    const mp3AudioFilePah = await this.convertAmrToMp3(rawAudioFilePath);
    const mp3AudioUrl = await this.getPublicMp3Url(mp3AudioFilePah);
    const voiceText = await ctx.service.aiModel.speechToText(mp3AudioUrl);
    ctx.logger.info('语音消息识别结果:', voiceText);
    return voiceText;
  }
  async downAmrVoice(messageData) {
    const { logger, service } = this;
    const mediaId = messageData.MediaId16K || messageData.MediaId;
    const fromUser = messageData.FromUserName;
    const originalFormat = messageData.Format;
    const rawAudioFileName = `${mediaId}_${fromUser}_raw.${originalFormat || 'amr'}`;
    const rawAudioFilePath = path.join(this.publicTempDir, rawAudioFileName);
    logger.info(`${fromUser} - Downloading voice media ${mediaId} to ${rawAudioFilePath}`);

    const downloadSuccess = await service.wechatApi.getTempMediaAndSave(mediaId, rawAudioFilePath); // 修改这里

    if (!downloadSuccess) {
      logger.error(`${fromUser} - Failed to download voice media ${mediaId}.`);
      // rawAudioFilePath 可能未创建或已被 getTempMediaAndSave 内部清理
      return null;
    }
    logger.info(`${fromUser} - Voice media ${mediaId} downloaded successfully.`);
    return rawAudioFilePath;
  }
  /**
   * 将AMR文件转换为MP3格式
   * @param {string} amrFilePath AMR文件的绝对路径
   * @return {Promise<string|null>} 转换后的MP3文件路径, 或失败时返回null
   */
  async convertAmrToMp3(amrFilePath) {
    const amrFileName = path.basename(amrFilePath, '.amr');
    const hash = crypto
      .createHash('sha1')
      .update(amrFileName + Date.now())
      .digest('hex')
      .substring(0, 10);
    const mp3FileName = `${amrFileName}_${hash}.mp3`;
    const mp3FilePath = path.join(this.publicTempDir, mp3FileName);
    const ffmpegCmd = `ffmpeg -i "${amrFilePath}" -acodec libmp3lame -q:a 2 "${mp3FilePath}"`; // -q:a 2 表示较好的VBR质量

    this.logger.info(`[wechatmpService]  AMR to MP3: ${amrFilePath} -> ${mp3FilePath}`);
    try {
      // eslint-disable-next-line no-unused-vars
      const { stdout, stderr } = await execPromise(ffmpegCmd);
      if (stderr && !stderr.includes('Output file #0')) {
        // ffmpeg 有时会将转换信息输出到 stderr
        this.logger.warn(
          `[wechatmpService] ffmpeg stderr during conversion of ${amrFilePath}:`,
          stderr
        );
      }
      this.logger.info(`[wechatmpService] MP3 converted successfully: ${mp3FilePath}`);

      return mp3FilePath;
    } catch (error) {
      this.logger.error(`[wechatmpService] ffmpeg conversion failed for ${amrFilePath}:`, error);
      this.logger.error(`[wechatmpService] ffmpeg stdout:`, error.stdout);
      this.logger.error(`[wechatmpService] ffmpeg stderr:`, error.stderr);

      return null;
    }
  }
  /**
   * 获取MP3文件的公网可访问URL
   * @param {string} mp3FilePath 本地MP3文件绝对路径
   * @return {string|null} 公网URL, 或无法生成时返回null
   */
  async getPublicMp3Url(mp3FilePath) {
    const { app } = this;
    const { appBaseUrl, tempMediaDirName } = app.config;
    const { prefix } = app.config.static;
    const mp3FileName = path.basename(mp3FilePath);
    const publicMp3Url = `${appBaseUrl}${prefix}${tempMediaDirName}/${mp3FileName}`;
    return publicMp3Url;
  }
}

module.exports = WechatmpService;
