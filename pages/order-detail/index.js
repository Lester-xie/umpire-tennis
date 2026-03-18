Page({
  data: {
    orderType: 'court', // 订单类型：court 场地订单 | goods 商品订单
    orderDate: '', // 预订日期
    formattedDate: '', // 格式化后的日期
    campusName: '', // 球馆名称，来自当前选定的球场
    orderNumber: '', // 订单编号
    orderItems: [], // 场地订单项 [{courtId, courtName, timeSlots: [{timeRange, price, hours}], totalPrice}]
    goodItem: null, // 商品订单项 {id, image, desc, price}
    totalPrice: 0, // 总价
    contentScrollHeight: 400, // scroll-view 可滚动区域高度，动态计算
    footerButtonText: '确认付款', // 底部按钮文案：未登录时为「去登录」
  },

  onLoad(options) {
    this.syncCampusName();
    if (options.type === 'goods') {
      // 商品订单：从 group-buy 页面跳转
      try {
        const goodItem = JSON.parse(decodeURIComponent(options.goodData || '{}'));
        if (goodItem && goodItem.price != null) {
          this.setData({
            orderType: 'goods',
            goodItem,
            totalPrice: goodItem.price,
          });
          return;
        }
      } catch (e) {
        console.error('解析商品数据失败', e);
      }
    }

    // 场地订单：从 booking 页面跳转
    const selectedSlots = JSON.parse(decodeURIComponent(options.selectedSlots || '[]'));
    const selectedDate = decodeURIComponent(options.selectedDate || '');
    const courts = JSON.parse(decodeURIComponent(options.courts || '[]'));
    
    const orderNumber = this.generateOrderNumber();
    const orderItems = this.processOrderItems(selectedSlots, courts);
    const totalPrice = this.calculateTotalPrice(orderItems);
    const formattedDate = this.formatDate(selectedDate);
    
    this.setData({
      orderDate: selectedDate,
      formattedDate: formattedDate,
      orderNumber: orderNumber,
      orderItems: orderItems,
      totalPrice: totalPrice,
    });
    this.syncCampusName();
  },

  syncCampusName() {
    const app = getApp();
    const venue = app && app.globalData && app.globalData.selectedVenue;
    const campusName = (venue && venue.name) ? venue.name : '昂湃网球学练馆';
    if (campusName !== this.data.campusName) {
      this.setData({ campusName });
    }
  },

  onShow() {
    this.syncCampusName();
    this.updateFooterButtonText();
  },

  onReady() {
    this.calculateContentScrollHeight();
    this.updateFooterButtonText();
  },

  // 根据登录状态更新底部按钮文案
  updateFooterButtonText() {
    const app = getApp();
    const footerButtonText = app.checkLogin() ? '确认付款' : '去登录';
    this.setData({ footerButtonText });
  },

  // 动态计算 scroll-view 高度：窗口高度 - header - footer - 间距
  calculateContentScrollHeight() {
    const systemInfo = wx.getSystemInfoSync();
    const windowHeight = systemInfo.windowHeight;

    const query = wx.createSelectorQuery();
    query.select('.header').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      const headerHeight = headerRect ? headerRect.height : 0;
      const headerFallback = (systemInfo.statusBarHeight || 44) + 44; // statusBar + 导航栏
      const finalHeaderHeight = headerHeight > 0 ? headerHeight : headerFallback;

      // footer 高度：内边距 8*2 + 按钮约 36 + 底部安全区
      const safeAreaBottom = systemInfo.safeArea
        ? systemInfo.screenHeight - systemInfo.safeArea.bottom
        : 0;
      const footerHeight = 16 + 36 + safeAreaBottom + 8;

      const contentScrollHeight = Math.max(
        windowHeight - finalHeaderHeight - footerHeight - 10,
        200
      );

      this.setData({
        contentScrollHeight,
      });
    });
  },

  // 生成订单编号
  generateOrderNumber() {
    const date = new Date();
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();
    const random = Math.floor(Math.random() * 10000);
    
    const formatNumber = (num) => num < 10 ? `0${num}` : `${num}`;
    const formatRandom = (num) => {
      if (num < 10) return `000${num}`;
      if (num < 100) return `00${num}`;
      if (num < 1000) return `0${num}`;
      return `${num}`;
    };
    
    return `${year}${formatNumber(month)}${formatNumber(day)}${formatNumber(hours)}${formatNumber(minutes)}${formatNumber(seconds)}${formatRandom(random)}`;
  },

  // 处理订单项，按场地分组
  processOrderItems(selectedSlots, courts) {
    const orderMap = {};
    
    selectedSlots.forEach(slot => {
      const court = courts.find(c => c.id === slot.courtId);
      if (!court) return;
      
      const slotData = court.slots[slot.slotIndex];
      if (!slotData || !slotData.available) return;
      
      const key = slot.courtId;
      if (!orderMap[key]) {
        orderMap[key] = {
          courtId: slot.courtId,
          courtName: court.name,
          timeSlots: [],
          totalPrice: 0,
        };
      }
      
      // 找到对应的时间段
      const timeSlot = {
        slotIndex: slot.slotIndex,
        time: this.getTimeSlotTime(slot.slotIndex),
        price: slotData.price,
      };
      
      orderMap[key].timeSlots.push(timeSlot);
      orderMap[key].totalPrice += slotData.price;
    });
    
    // 对每个场地的时间段进行合并处理
    Object.keys(orderMap).forEach(key => {
      orderMap[key].timeSlots = this.mergeTimeSlots(orderMap[key].timeSlots);
    });
    
    return Object.values(orderMap);
  },
  
  // 合并连续的时间段
  mergeTimeSlots(timeSlots) {
    if (timeSlots.length === 0) return [];
    
    // 按 slotIndex 排序
    const sorted = [...timeSlots].sort((a, b) => a.slotIndex - b.slotIndex);
    const merged = [];
    
    let currentRange = {
      startIndex: sorted[0].slotIndex,
      endIndex: sorted[0].slotIndex,
      startTime: sorted[0].time,
      endTime: this.getTimeSlotEndTime(sorted[0].slotIndex),
      price: sorted[0].price,
      hours: 1,
    };
    
    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      
      // 如果当前时间段与上一个连续
      if (current.slotIndex === currentRange.endIndex + 1) {
        currentRange.endIndex = current.slotIndex;
        currentRange.endTime = this.getTimeSlotEndTime(current.slotIndex);
        currentRange.price += current.price;
        currentRange.hours += 1;
      } else {
        // 不连续，保存当前范围，开始新范围
        merged.push({
          timeRange: `${currentRange.startTime}-${currentRange.endTime}`,
          hours: currentRange.hours,
          price: currentRange.price,
        });
        
        currentRange = {
          startIndex: current.slotIndex,
          endIndex: current.slotIndex,
          startTime: current.time,
          endTime: this.getTimeSlotEndTime(current.slotIndex),
          price: current.price,
          hours: 1,
        };
      }
    }
    
    // 添加最后一个范围
    merged.push({
      timeRange: `${currentRange.startTime}-${currentRange.endTime}`,
      hours: currentRange.hours,
      price: currentRange.price,
    });
    
    return merged;
  },

  // 根据索引获取时间段开始时间
  getTimeSlotTime(slotIndex) {
    const hour = 8 + slotIndex;
    const hourStr = hour < 10 ? `0${hour}` : `${hour}`;
    return `${hourStr}:00`;
  },
  
  // 根据索引获取时间段结束时间（显示为 15:59 格式）
  getTimeSlotEndTime(slotIndex) {
    const hour = 8 + slotIndex;
    const hourStr = hour < 10 ? `0${hour}` : `${hour}`;
    return `${hourStr}:59`;
  },
  
  // 格式化日期
  formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const weekday = weekdays[date.getDay()];
    
    return `${year}.${month < 10 ? '0' + month : month}.${day < 10 ? '0' + day : day} ${weekday}`;
  },

  // 计算总价
  calculateTotalPrice(orderItems) {
    return orderItems.reduce((total, item) => total + item.totalPrice, 0);
  },

  // 保存订单到本地存储（供 profile 页面的订场/团购历史展示）
  saveOrderToStorage() {
    const { orderType, orderNumber, formattedDate, orderDate, campusName, orderItems, goodItem, totalPrice } = this.data;
    const createdAt = Date.now();
    try {
      if (orderType === 'court') {
        const courtOrders = wx.getStorageSync('court_orders') || [];
        courtOrders.unshift({
          orderNumber,
          formattedDate,
          orderDate,
          campusName,
          orderItems,
          totalPrice,
          createdAt,
        });
        wx.setStorageSync('court_orders', courtOrders);
      } else if (orderType === 'goods' && goodItem) {
        const goodsOrders = wx.getStorageSync('goods_orders') || [];
        goodsOrders.unshift({
          orderNumber,
          goodItem,
          totalPrice,
          createdAt,
        });
        wx.setStorageSync('goods_orders', goodsOrders);
      }
    } catch (e) {
      console.error('保存订单到本地失败', e);
    }
  },

  // 处理底部按钮点击：未登录时去登录，已登录时确认付款
  handleSubmitOrder() {
    const app = getApp();
    if (!app.checkLogin()) {
      wx.showLoading({ title: '登录中...' });
      app.doLogin()
        .then(() => {
          wx.hideLoading();
          wx.showToast({ title: '登录成功', icon: 'success', duration: 1000 });
          this.updateFooterButtonText();
        })
        .catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '登录失败，请重试', icon: 'none' });
        });
      return;
    }

    wx.showLoading({ title: '提交中...' });
    // TODO: 调用后端接口提交订单
    this.saveOrderToStorage();
    setTimeout(() => {
      wx.hideLoading();
      wx.showToast({
        title: '订单提交成功',
        icon: 'success',
      });
      if (this.data.orderType === 'court') {
        app.globalData.shouldClearBookingData = true;
      }
      setTimeout(() => wx.navigateBack(), 1500);
    }, 1000);
  },
});
