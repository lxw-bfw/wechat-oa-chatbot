// app/extend/helper.js
'use strict';

const xml2js = require('xml2js');

module.exports = {
  /**
   * 构建回复给微信的文本消息XML
   * @param {string} toUser - 接收方帐号 (用户的OpenID)
   * @param {string} fromUser - 开发者微信号 (公众号的原始ID)
   * @param {string} content - 回复的消息内容
   * @return {string} XML字符串
   */
  formatTextReply(toUser, fromUser, content) {
    const message = {
      ToUserName: toUser,
      FromUserName: fromUser,
      CreateTime: Math.floor(Date.now() / 1000),
      MsgType: 'text',
      Content: content,
    };
    const builder = new xml2js.Builder({ rootName: 'xml', cdata: true, headless: true });
    return builder.buildObject(message);
  },

  /**
   * 解析微信发送过来的XML消息
   * @param {string} xmlStr XML字符串
   * @return {Promise<object>} 解析后的JS对象
   */
  async parseXml(xmlStr) {
    return new Promise((resolve, reject) => {
      xml2js.parseString(xmlStr, { explicitArray: false, trim: true }, (err, result) => {
        if (err) {
          return reject(err);
        }
        resolve(result ? result.xml : {});
      });
    });
  },

  /**
   * 计算字符串的UTF-8字节长度
   * @param {string} str 输入字符串
   * @return {number} 字节长度
   */
  getUtf8ByteLength(str) {
    return Buffer.from(str, 'utf-8').length;
  },

  /**
   * 按字节长度截断UTF-8字符串
   * @param {string} str 要截断的字符串
   * @param {number} maxLength 最大字节长度
   * @param {string} suffix 截断后追加的后缀，如 "..."
   * @return {string} 截断后的字符串
   */
  truncateStringByBytes(str, maxLength, suffix = '') {
    const buffer = Buffer.from(str, 'utf-8');
    const suffixBuffer = Buffer.from(suffix, 'utf-8');
    if (buffer.length <= maxLength) {
      return str;
    }

    const truncatedLength = maxLength - suffixBuffer.length;
    if (truncatedLength <= 0) {
      // 如果连后缀都放不下
      // 尝试只放后缀，如果后缀本身超长，则截断后缀
      if (suffixBuffer.length > maxLength) {
        return this.truncateStringByBytes(suffix, maxLength, '');
      }
      return suffix;
    }

    let validBytes = 0;
    let charCount = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      const charBytes = Buffer.from(char, 'utf-8').length;
      if (validBytes + charBytes <= truncatedLength) {
        validBytes += charBytes;
        charCount++;
      } else {
        break;
      }
    }
    return str.substring(0, charCount) + suffix;
  },
  /**
   * 根据用户id返回当前消息缓存内容
   * @param {string} openId - 用户的OpenID
   */
  async getFromCache(openId) {
    const cached = await this.app.redis.get(`wechatmp:${openId}`);
    console.log('redis缓存：读取缓存:', { key: `wechatmp:${openId}` });
    return cached ? JSON.parse(cached) : null;
  },

  /**
   * 根据用户id缓存当前消息内容
   * @param {string} openId - 用户的OpenID
   * @param {object} entry - 要缓存的消息内容
   * @param {number} ttlSeconds - 缓存的过期时间（秒）
   */
  async setToCache(openId, entry, ttlSeconds) {
    // ttlSeconds 例如 app.config.aiModel.cacheTTLSeconds
    await this.app.redis.set(`wechatmp:${openId}`, JSON.stringify(entry), 'EX', ttlSeconds);
    console.log('redis缓存：设置:', { key: `wechatmp:${openId}` }, entry);
  },

  /**
   * 根据用户id删除缓存的消息内容
   * @param {string} openId - 用户的OpenID
   */
  async deleteFromCache(openId) {
    await this.app.redis.del(`wechatmp:${openId}`);
    console.log('redis缓存：删除缓存:', { key: `wechatmp:${openId}` });
  },
};
