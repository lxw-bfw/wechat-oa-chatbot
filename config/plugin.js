/** @type Egg.EggPlugin */
module.exports = {
  // had enabled by egg
  // static: {
  //   enable: true,
  // }
  routerPlus: {
    enable: true,
    package: 'egg-router-plus',
  },
  redis: {
    enable: true,
    package: 'egg-redis',
  },
};
