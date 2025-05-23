// app/service/wechatToken.js
const Service = require('egg').Service;
const assert = require('assert');
const crypto = require('crypto'); // 用于生成锁的唯一值

class WechatTokenService extends Service {
  /**
   * 获取当前有效的 AccessToken
   * 核心逻辑：
   * 1. 尝试从 Redis 读取 token 和过期时间。
   * 2. 如果 token 有效且未临近过期，直接返回。
   * 3. 否则，调用 refreshToken 尝试刷新。
   */
  async getAccessToken() {
    const { ctx, app, config } = this;
    const { redisTokenKey, redisTokenExpiresKey, tokenExpireAdvance } = config.wechat;
    const redis = app.redis;

    const storedToken = await redis.get(redisTokenKey);
    const storedExpiresAt = await redis.get(redisTokenExpiresKey);
    const now = Math.floor(Date.now() / 1000);

    if (
      storedToken &&
      storedExpiresAt &&
      parseInt(storedExpiresAt, 10) > now + tokenExpireAdvance
    ) {
      ctx.logger.info('[WechatTokenService] 使用缓存中的access_token.');
      return storedToken;
    }

    // 缓存无效或快过期，需要刷新
    ctx.logger.info('[WechatTokenService] token无效或即将过期，开始执行刷新.');
    return this.refreshToken();
  }

  /**
   * 刷新 AccessToken (核心逻辑，带分布式锁)
   * 1. 尝试获取分布式锁。
   * 2. 如果获取锁失败，表示其他进程正在刷新，则等待一小段时间后重试 getAccessToken。
   * 3. 如果获取锁成功：
   *    a. 再次检查 Redis 中的 token (双重检查锁)，防止在等待锁的过程中 token 已被刷新。
   *    b. 如果 token 仍然无效，则向微信服务器请求新 token。
   *    c. 将新 token 和过期时间存入 Redis。
   *    d. 释放分布式锁。
   * 4. 处理各种异常，并在失败时发送告警。
   */
  async refreshToken() {
    const { ctx, app, config } = this;
    const {
      accessTokenUrl,
      appId,
      appSecret,
      redisTokenKey,
      redisTokenExpiresKey,
      redisLockKey,
      lockTimeout,
      tokenExpireAdvance,
    } = config.wechat;
    const redis = app.redis;
    const lockValue = crypto.randomBytes(16).toString('hex'); // 锁的唯一值，防止误删

    ctx.logger.info(`[WechatTokenService] Attempting to acquire lock: ${redisLockKey}`);

    // 尝试获取锁
    const lockAcquired = await redis.set(redisLockKey, lockValue, 'PX', lockTimeout, 'NX');

    if (!lockAcquired) {
      ctx.logger.warn(
        '[WechatTokenService] Failed to acquire lock, another process might be refreshing. Waiting and retrying getAccessToken.'
      );
      await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
      return this.getAccessToken();
    }

    ctx.logger.info(`[WechatTokenService] 获取锁: ${redisLockKey} with value ${lockValue}`);
    try {
      // 保险期间，进行双重检查
      const currentToken = await redis.get(redisTokenKey);
      const currentExpiresAt = await redis.get(redisTokenExpiresKey);
      const now = Math.floor(Date.now() / 1000);

      if (
        currentToken &&
        currentExpiresAt &&
        parseInt(currentExpiresAt, 10) > now + tokenExpireAdvance
      ) {
        ctx.logger.info(
          '[WechatTokenService] 在等待锁期间access_tokenaccess_token已被其他进程刷新，返回现有token.'
        );
        return currentToken;
      }

      // 真正执行刷新操作
      ctx.logger.info('[WechatTokenService] 开始从微信接口中获取access_token.');
      const apiUrl = `${accessTokenUrl}?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
      const result = await ctx.curl(apiUrl, {
        dataType: 'json',
        timeout: 10000,
      });

      assert(
        result.status === 200,
        `从接口中获取 access_token失败, status: ${result.status}, data: ${JSON.stringify(result.data)}`
      );
      const data = result.data;

      if (data.access_token && data.expires_in) {
        const newAccessToken = data.access_token;
        const expiresIn = parseInt(data.expires_in, 10); // 通常是 7200 秒
        const newExpiresAt = now + expiresIn;

        // 存储到 Redis
        // 使用 multi / pipeline 保证原子性（虽然此处分开写影响不大，但良好习惯）
        const multi = redis.multi();
        multi.set(redisTokenKey, newAccessToken);
        multi.set(redisTokenExpiresKey, newExpiresAt.toString());
        // 可以给 token 设置一个 Redis 自身的过期时间，略长于微信的过期时间，作为兜底
        multi.expire(redisTokenKey, expiresIn + 600); // 比微信过期时间多10分钟
        multi.expire(redisTokenExpiresKey, expiresIn + 600);
        await multi.exec();

        ctx.logger.info(
          `[WechatTokenService] 获取到最新token并存储到Redis: ${newAccessToken}, expires_in: ${expiresIn}s`
        );
        return newAccessToken;
      }
      // 获取失败
      const errorMsg = `从微信接口中刷新access_token失败: ${JSON.stringify(data)}`;
      ctx.logger.error(`[WechatTokenService] ${errorMsg}`);
      // TODO: 增加告警提醒
      throw new Error(data.errmsg || 'Unknown error fetching access_token from WeChat');
    } catch (err) {
      const errorDetail = err.stack || err.message;
      ctx.logger.error(
        '[WechatTokenService] Error during access token refresh process:',
        errorDetail
      );
      // TODO: 发生严重错误时发送告警

      throw err; // 重新抛出异常，让上层知道
    } finally {
      // 释放锁：使用 Lua 脚本保证原子性，只有当 key 存在且 value 匹配时才删除
      const script = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        else
          return 0
        end
      `;
      try {
        const releaseResult = await redis.eval(script, 1, redisLockKey, lockValue);
        if (releaseResult === 1) {
          ctx.logger.info(`[WechatTokenService] Lock released: ${redisLockKey}`);
        } else {
          ctx.logger.warn(
            `[WechatTokenService] Lock ${redisLockKey} was not released by this instance (value mismatch or key expired). Current lock value may not be ${lockValue}.`
          );
        }
      } catch (e) {
        ctx.logger.error(
          `[WechatTokenService] CRITICAL: Failed to release lock ${redisLockKey}. Error: ${e.message}`
        );
      }
    }
  }

  /**
   * 被动/强制刷新接口
   * 官方access_token的有效时间可能会在未来有调整，便于业务服务器在API调用获知access_token已超时的情况下，可以触发access_token的刷新流程
   */
  async forceRefreshToken() {
    const { ctx, app, config } = this;
    const { redisTokenKey, redisTokenExpiresKey } = config.wechat;
    const redis = app.redis;

    ctx.logger.warn(
      '[WechatTokenService] Force refresh token requested. Clearing current token from Redis.'
    );
    try {
      const multi = redis.multi();
      multi.del(redisTokenKey);
      multi.del(redisTokenExpiresKey);
      await multi.exec();
      return this.refreshToken();
    } catch (err) {
      const errorDetail = err.stack || err.message;
      ctx.logger.error('[WechatTokenService] 被动刷新token过程中清除令牌缓存失败:', errorDetail);
      // TODO: 增加告警提醒

      throw err;
    }
  }
}
module.exports = WechatTokenService;
