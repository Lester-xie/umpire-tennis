/**
 * 主内容区可滚动高度（px）
 * @param {object} o
 * @param {number} o.windowHeight wx.getWindowInfo().windowHeight
 * @param {number} o.finalHeaderHeight 已含状态栏区域的 header 总高
 * @param {number} o.safeAreaBottom 底部安全区占用（非 home indicator 时可 0）
 * @param {number} [o.tabBarHeight] 传入则扣除（普通订场页）；不传则不扣（教练占场页当前布局）
 * @param {number} [o.contentBottomGap]
 * @param {number} [o.minHeight]
 */
function computeBookingMainContentHeightPx(o) {
  const contentBottomGap = o.contentBottomGap != null ? o.contentBottomGap : 46;
  const minHeight = o.minHeight != null ? o.minHeight : 400;
  let h = o.windowHeight - o.finalHeaderHeight - o.safeAreaBottom - contentBottomGap;
  if (o.tabBarHeight != null && Number.isFinite(o.tabBarHeight)) {
    h -= o.tabBarHeight;
  }
  return Math.max(h, minHeight);
}

/**
 * @param {number} headerRectHeight selectorQuery .header 高度，可能为 0
 * @param {object | undefined} screenInfo app.globalData.screenInfo
 */
function estimateBookingHeaderHeightPx(headerRectHeight, screenInfo) {
  let h = headerRectHeight || 0;
  if (!h || h === 0) {
    let headerPaddingTop = 0;
    if (screenInfo && screenInfo.headerInfo) {
      headerPaddingTop = screenInfo.headerInfo.headerPaddingTop || 0;
    }
    h = headerPaddingTop + 25;
  }
  return h;
}

module.exports = {
  computeBookingMainContentHeightPx,
  estimateBookingHeaderHeightPx,
};
