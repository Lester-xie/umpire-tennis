const { getCourses } = require('../../api/tennisDb');
const {
  ALL_CATEGORY_ID,
  collectHomeExcludedCategoryRefs,
  isCourseInHomeExcludedCategory,
} = require('../../utils/constants');
const {
  pickCourseScale,
  pickCategory,
  courseImageSource,
  formatCourseRow,
  DEFAULT_GOODS_IMAGE,
} = require('../../utils/courseCatalog');
const { venueIdLooseEqual, normalizeVenueId } = require('../../utils/venueId');

/** cloud:// fileID → 临时 https，切换分类时复用，避免重复 getTempFileURL 卡顿 */
const cloudTempUrlCache = Object.create(null);

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
    goodsEmptyHint: '',
  },

  /** 缓存 key：分类 + 当前所选场馆（切换场馆需重新筛） */
  _formattedGoodsMemo: null,

  lifetimes: {
    attached() {
      this._formattedGoodsMemo = Object.create(null);
      this.loadCourses();
    },
  },

  pageLifetimes: {
    show() {
      this.loadCourses();
    },
  },

  methods: {
    loadCourses() {
      const categoryId = this.properties.categoryId;
      const app = getApp();
      const venue = app && app.globalData && app.globalData.selectedVenue;
      const selectedVenueId = normalizeVenueId(venue && venue.id);
      const cacheKey = `${categoryId}@@${selectedVenueId || '__none__'}`;
      const memo = this._formattedGoodsMemo;
      if (memo && memo[cacheKey]) {
        this.setData({
          goods: memo[cacheKey].goods,
          courseLoaded: true,
          goodsEmptyHint: memo[cacheKey].hint,
        });
        return;
      }
      getCourses(categoryId)
        .then(({ data, scaleById, categoryById }) =>
          resolveCourseImages(data || []).then((rows) => ({ rows, scaleById, categoryById })),
        )
        .then(({ rows, scaleById, categoryById }) => {
          const excludedCats = collectHomeExcludedCategoryRefs(categoryById);
          let baseRows = rows.filter((c) => !isCourseInHomeExcludedCategory(c, excludedCats));
          let hint = '';
          let filtered = baseRows;
          if (!selectedVenueId) {
            filtered = [];
            hint = '请先在顶部选择场馆，再查看该馆课程与价格';
          } else {
            filtered = baseRows.filter((c) => venueIdLooseEqual(c.venue, selectedVenueId));
            if (!filtered.length) {
              hint = '当前场馆暂无上架课程';
            }
          }
          const sid = scaleById || {};
          const cid = categoryById || {};
          const goods = filtered.map((c) =>
            formatCourseRow(c, pickCourseScale(sid, c.type), pickCategory(cid, c.category)),
          );
          if (this._formattedGoodsMemo) {
            this._formattedGoodsMemo[cacheKey] = { goods, hint };
          }
          this.setData({
            goods,
            courseLoaded: true,
            goodsEmptyHint: hint,
          });
        })
        .catch((err) => {
          console.warn('getCourses failed', err);
          this.setData({ goods: [], courseLoaded: true, goodsEmptyHint: '' });
        });
    },

    handleGoodClick(e) {
      const index = e.currentTarget.dataset.index;
      const good = this.data.goods[index];
      if (!good) return;
      const app = getApp();
      const venue = app && app.globalData && app.globalData.selectedVenue;
      const venueName = venue && venue.name ? String(venue.name) : '';
      const goodData = encodeURIComponent(
        JSON.stringify({
          id: good.id,
          image: good.image,
          desc: good.desc,
          price: good.price,
          grantHours: good.grantHours,
          lessonKey: good.lessonKey,
          venueId: good.venueId,
          venueName,
        }),
      );
      wx.navigateTo({
        url: `/pages/order-detail/index?type=goods&goodData=${goodData}`,
      });
    },
  },
});
