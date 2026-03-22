const { getCategories } = require('../../api/tennisDb');
const { ALL_CATEGORY_ID, isCategoryExcludedFromHome } = require('../../utils/constants');

function buildAllCategoryItem() {
  return {
    _id: ALL_CATEGORY_ID,
    name: '全部',
    isAll: true,
  };
}

Component({
  data: {
    categories: [],
    /** 当前选中项 _id，默认「全部」 */
    selectedId: ALL_CATEGORY_ID,
  },

  lifetimes: {
    attached() {
      this.loadCategories();
    },
  },

  methods: {
    loadCategories() {
      getCategories()
        .then((res) => {
          let list = (res.data || []).filter((c) => c && !isCategoryExcludedFromHome(c));
          list = [...list].sort(
            (a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999),
          );
          this.setData({
            categories: [buildAllCategoryItem(), ...list],
          });
        })
        .catch((err) => {
          console.warn('getCategories failed', err);
          this.setData({ categories: [buildAllCategoryItem()] });
        });
    },

    onCategoryTap(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.categories[index];
      if (!item) return;
      this.setData({ selectedId: item._id });
      this.triggerEvent('tap', {
        id: item._id,
        name: item.name,
        isAll: !!item.isAll,
      });
    },
  },
});
