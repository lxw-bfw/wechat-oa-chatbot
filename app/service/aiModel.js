'use strict';

const Service = require('egg').Service;
const OpenAI = require('openai');
const SYSTEMPROMPT = require('../utils/systemPrompt');

class AiModelService extends Service {
  /**
   *  获取大模型的回答
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
}

module.exports = AiModelService;
