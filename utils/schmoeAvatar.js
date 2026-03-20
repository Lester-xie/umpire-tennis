/**
 * Joe Schmoe 头像 API：https://joesch.moe/api/v1/:seed
 * 同一 seed 始终返回同一头像；以下名字来自官网文档
 * @see https://joesch.moe/api/v1/joe
 */

const SCHMOE_NAMES = [
  'jocelyn',
  'jaqueline',
  'jed',
  'jabala',
  'jacques',
  'jack',
  'jeri',
  'josh',
  'josephine',
  'jake',
  'jana',
  'jenni',
  'jolee',
  'jai',
  'jess',
  'joe',
  'jeane',
  'jon',
  'jazebelle',
  'jean',
  'jane',
  'jodi',
  'james',
  'jordan',
  'jerry',
  'julie',
  'jude',
  'jia',
];

/**
 * 首次注册用户：随机选一个官方名字，写入 user.avatar（完整 URL）
 */
function getRandomSchmoeAvatarUrl() {
  const name = SCHMOE_NAMES[Math.floor(Math.random() * SCHMOE_NAMES.length)];
  return `https://joesch.moe/api/v1/${name}`;
}

module.exports = {
  getRandomSchmoeAvatarUrl,
  SCHMOE_NAMES,
};
