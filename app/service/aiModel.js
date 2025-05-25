'use strict';

const Service = require('egg').Service;
const OpenAI = require('openai');
const SYSTEMPROMPT = require('../utils/systemPrompt');

class AiModelService extends Service {
  /**
   *  根据文本prompt获取大模型的回答
   * @param {string} prompt - User input prompt
   * @param {object} options - Additional options for the model
   * @return {AsyncGenerator} - Stream of response chunks
   */
  async getAiModelByTextPrompt(prompt, options = {}) {
    const { app } = this;
    const { apiKey, apiUrl, aiModel } = app.config.aiModel;
    const defaultOptions = {
      model: aiModel,
      messages: [...SYSTEMPROMPT.DEEPSEEK, { role: 'user', content: prompt }],
      temperature: 1.3,
      max_tokens: 8192,
    };

    const requestOptions = { ...defaultOptions, ...options };
    const openai = new OpenAI({
      baseURL: apiUrl,
      apiKey,
    });
    const completion = await openai.chat.completions.create(requestOptions);
    return completion.choices[0].message.content;
  }
  /**
   *  文本转语音
   * @param {string} audioUrl - mp3等格式的音频地址
   * @return {text} - 识别后的文本
   */
  async speechToText(audioUrl) {
    const { app, ctx } = this;
    const logger = ctx.logger;
    const { serviceUrl, appId, token, cluster } = app.config.speechAiConfig;

    const headers = {
      Authorization: `Bearer; ${token}`,
      'Content-Type': 'application/json',
    };

    async function submitTask() {
      const request = {
        app: {
          appid: appId,
          token,
          cluster,
        },
        user: {
          uid: '388808087185088_demo',
        },
        audio: {
          format: 'mp3',
          url: audioUrl,
        },
        additions: {
          with_speaker_info: 'False',
        },
      };

      try {
        const response = await fetch(`${serviceUrl}/submit`, {
          method: 'POST',
          headers,
          body: JSON.stringify(request),
        });
        const respDic = await response.json();
        console.log(respDic);
        const id = respDic.resp.id;
        console.log('语音识别任务id', id);
        return id;
      } catch (error) {
        logger.error('语音转文本识别任务提交失败:', error);
        throw error;
      }
    }

    async function queryTask(taskId) {
      const queryDic = {
        appid: appId,
        token,
        id: taskId,
        cluster,
      };

      try {
        const response = await fetch(`${serviceUrl}/query`, {
          method: 'POST',
          headers,
          body: JSON.stringify(queryDic),
        });
        const respDic = await response.json();
        return respDic;
      } catch (error) {
        logger.error('语音转文本queryTask执行失败', error);
        throw error;
      }
    }

    async function fileRecognize() {
      try {
        const taskId = await submitTask();
        const startTime = Date.now();
        const shouldContinue = true;

        while (shouldContinue) {
          await new Promise(resolve => setTimeout(resolve, 1500));

          const respDic = await queryTask(taskId);

          if (respDic.resp.code === 1000) {
            console.log('success');
            logger.info('语音识别成功', respDic.resp);
            return respDic.resp.text;
          } else if (respDic.resp.code < 2000) {
            logger.error('语音识别失败', respDic.resp);
            return null;
          }

          const nowTime = Date.now();
          if (nowTime - startTime > 300000) {
            logger.warn('语音识别超时：wait time exceeds 300s');
            return null;
          }
        }
      } catch (error) {
        logger.error('语音识别失败', error);
      }
    }

    const speechText = await fileRecognize();
    return speechText;
  }
}

module.exports = AiModelService;
