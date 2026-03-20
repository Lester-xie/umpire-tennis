const { goods } = require('../../data/goods');

Component({
  properties: {},
  data: { goods },
  methods: {
    handleGoodClick(e) {
      const index = e.currentTarget.dataset.index;
      const good = this.data.goods[index];
      if (!good) return;
      const goodData = encodeURIComponent(JSON.stringify({
        id: good.id,
        image: good.image,
        desc: good.desc,
        price: good.price,
      }));
      wx.navigateTo({
        url: `/pages/order-detail/index?type=goods&goodData=${goodData}`,
      });
    },
  },
});
