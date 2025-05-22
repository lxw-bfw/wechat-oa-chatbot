module.exports.USERMESSAGECACHE = () => ({
  status: 0, // 0：正常提问，1：超过微信官方被动接口5秒内回复，2：超过三次重试最多15（保险一点可以设置14.5）秒限制；3：当前文本过长，分段回复
  msgContent: '', // AI的回复内容，或失败信息
  originalQuery: '', // 用户原始问题
  firstTimestamp: 0, // 首次时间戳
  parts: [], // 如果是分段消息，存储剩余部分，采用队列模式
});
