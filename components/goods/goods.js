const { getCourses } = require('../../api/tennisDb');
const { ALL_CATEGORY_ID } = require('../../utils/constants');

const DEFAULT_GOODS_IMAGE = '/assets/images/goods/good1.jpg';

/** cloud:// fileID → 临时 https，切换分类时复用，避免重复 getTempFileURL 卡顿 */
const cloudTempUrlCache = Object.create(null);

/** 课程图：优先 picture，其次兼容旧字段 image */
function courseImageSource(c) {
  const pic =
    c.picture != null && String(c.picture).trim() !== ''
      ? String(c.picture).trim()
      : '';
  if (pic) return pic;
  const img =
    c.image != null && String(c.image).trim() !== ''
      ? String(c.image).trim()
      : '';
  return img;
}

function mapCoursesDisplayImages(list) {
  return list.map((c) => {
    const src = courseImageSource(c);
    let displayImage = DEFAULT_GOODS_IMAGE;
    if (src) {
      if (src.startsWith('cloud://')) {
        displayImage = cloudTempUrlCache[src] || src;
      } else {
        displayImage = src;
      }
    }
    return { ...c, displayImage };
  });
}

function resolveCourseImages(list) {
  if (!list.length) return Promise.resolve(list);
  const cloudIds = [
    ...new Set(
      list
        .map((c) => courseImageSource(c))
        .filter((u) => u && String(u).startsWith('cloud://')),
    ),
  ];
  if (!cloudIds.length) {
    return Promise.resolve(mapCoursesDisplayImages(list));
  }
  const pending = cloudIds.filter((id) => !cloudTempUrlCache[id]);
  if (!pending.length) {
    return Promise.resolve(mapCoursesDisplayImages(list));
  }
  return new Promise((resolve) => {
    wx.cloud.getTempFileURL({
      fileList: pending.map((fileID) => ({ fileID })),
      success: (res) => {
        (res.fileList || []).forEach((f) => {
          if (f.fileID && f.tempFileURL) {
            cloudTempUrlCache[f.fileID] = f.tempFileURL;
          }
        });
        resolve(mapCoursesDisplayImages(list));
      },
      fail: () => {
        resolve(mapCoursesDisplayImages(list));
      },
    });
  });
}

function formatCourseRow(c) {
  const titleRaw = c.title != null ? String(c.title).trim() : '';
  const title = titleRaw || '课程';
  const typeLabel =
    c.type != null && String(c.type).trim() !== ''
      ? String(c.type).trim()
      : '';
  const categoryLabel =
    c.categoryLabel != null && String(c.categoryLabel).trim() !== ''
      ? String(c.categoryLabel).trim()
      : '';
  const subtitle =
    c.unit != null && String(c.unit).trim() !== ''
      ? String(c.unit).trim()
      : '';
  const desc = [title, typeLabel, categoryLabel, subtitle]
    .filter(Boolean)
    .join(' · ');
  return {
    id: c._id,
    image: c.displayImage || courseImageSource(c) || DEFAULT_GOODS_IMAGE,
    title,
    typeLabel,
    categoryLabel,
    subtitle,
    desc,
    price: c.price,
  };
}

Component({
  properties: {
    /** 与 category 选中项 _id 一致；为 ALL_CATEGORY_ID 时不按 category 筛选 */
    categoryId: {
      type: String,
      value: ALL_CATEGORY_ID,
      observer(newVal, oldVal) {
        /** 首次注入属性时 oldVal 为 undefined，由 lifetimes.attached 负责首查，避免重复请求 */
        if (oldVal === undefined) return;
        this.loadCourses();
      },
    },
  },

  data: {
    goods: [],
    courseLoaded: false,
  },

  /** 按分类缓存已格式化的列表，切回已点过的分类时不再跑一遍解析与 setData 大图 */
  _formattedGoodsByCategory: null,

  lifetimes: {
    attached() {
      this._formattedGoodsByCategory = Object.create(null);
      this.loadCourses();
    },
  },

  methods: {
    loadCourses() {
      const categoryId = this.properties.categoryId;
      const memo = this._formattedGoodsByCategory;
      if (memo && memo[categoryId]) {
        this.setData({
          goods: memo[categoryId],
          courseLoaded: true,
        });
        return;
      }
      getCourses(categoryId)
        .then((res) => resolveCourseImages(res.data || []))
        .then((rows) => {
          const goods = rows.map(formatCourseRow);
          if (this._formattedGoodsByCategory) {
            this._formattedGoodsByCategory[categoryId] = goods;
          }
          this.setData({
            goods,
            courseLoaded: true,
          });
        })
        .catch((err) => {
          console.warn('getCourses failed', err);
          this.setData({ goods: [], courseLoaded: true });
        });
    },

    handleGoodClick(e) {
      const index = e.currentTarget.dataset.index;
      const good = this.data.goods[index];
      if (!good) return;
      const goodData = encodeURIComponent(
        JSON.stringify({
          id: good.id,
          image: good.image,
          desc: good.desc,
          price: good.price,
        }),
      );
      wx.navigateTo({
        url: `/pages/order-detail/index?type=goods&goodData=${goodData}`,
      });
    },
  },
});
