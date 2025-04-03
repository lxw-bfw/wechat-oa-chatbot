module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // https://zj-git-guide.readthedocs.io/zh-cn/latest/message/Angular%E6%8F%90%E4%BA%A4%E4%BF%A1%E6%81%AF%E8%A7%84%E8%8C%83/
    'type-enum': [2, 'always', ['feat', 'fix', 'revert', 'build', 'ci', 'docs', 'pref', 'test']],
    'subject-max-length': [1, 'always', 100],
  },
};
