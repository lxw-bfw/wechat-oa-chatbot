'use strict';

const Service = require('egg').Service;
const OpenAI = require('openai');
const SYSTEMPROMPT = require('../utils/systemPrompt');
// 读取DEEPSEEK_API_KEY环境变量
const DEEPSEEKAPIKEY = process.env.DEEPSEEK_API_KEY;
// 读取DEEPSEEK_URL环境变量
const DEEPSEEKURL = process.env.DEEPSEEK_URL;

console.log(`DEEPSEEK_API_KEY: ${DEEPSEEKAPIKEY}`);
console.log(`DEEPSEEK_URL: ${DEEPSEEKURL}`);

class WechatService extends Service {
  /**
   * Chat R1 Stream method
   * @param {string} prompt - User input prompt
   * @param {object} options - Additional options for the model
   * @return {AsyncGenerator} - Stream of response chunks
   */
  async chatR1Stream(prompt, options = {}) {
    const defaultOptions = {
      model: 'deepseek-reasoner',
      messages: [...SYSTEMPROMPT.DEEPSEEK, { role: 'user', content: prompt }],
      temperature: 1.3,
      max_tokens: 8192,
      stream: true,
    };

    const requestOptions = { ...defaultOptions, ...options };
    const openai = new OpenAI({
      baseURL: DEEPSEEKURL,
      apiKey: DEEPSEEKAPIKEY,
    });
    return await openai.chat.completions.create(requestOptions);
  }
}

module.exports = WechatService;
