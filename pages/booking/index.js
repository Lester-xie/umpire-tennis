Page({
  data: {
    dateList: [], // 日期列表
    selectedDate: '', // 选中的日期字符串
    rippleDate: '', // 当前显示波纹动画的日期
    timeSlots: [], // 时间段列表
    courts: [], // 场地列表
    contentHeight: 400, // content 高度
    selectedSlots: [], // 选中的时间段 [{courtId, slotIndex}]
    selectedSlotsMap: {}, // 选中状态映射 {courtId-slotIndex: true}
    rippleSlot: null, // 当前显示波纹动画的时间段 {courtId, slotIndex}
    totalPrice: 0, // 总价
    selectedVenueName: '', // 当前选定的球场名称
  },
  
  // 动画定时器
  rippleTimer: null,
  slotRippleTimer: null,
  
  onLoad() {
    this.syncSelectedVenueName();
    // 生成最近两个月的日期列表
    this.generateDateList();
    // 生成时间段和场地数据
    this.generateTimeSchedule();
  },

  onShow() {
    this.syncSelectedVenueName();
    // 检查是否需要清空数据（下单成功后返回）
    const app = getApp();
    if (app && app.globalData && app.globalData.shouldClearBookingData) {
      this.clearBookingData();
      app.globalData.shouldClearBookingData = false;
    }
  },

  syncSelectedVenueName() {
    const app = getApp();
    const venue = app && app.globalData && app.globalData.selectedVenue;
    const name = (venue && venue.name) ? venue.name : '';
    if (name !== this.data.selectedVenueName) {
      this.setData({ selectedVenueName: name });
      // 切换球馆后重置已选择的时间段
      this.resetSelectedSlots();
    }
  },

  // 仅重置已选时间段（不重新生成场地/时段数据）
  resetSelectedSlots() {
    this.setData({
      selectedSlots: [],
      selectedSlotsMap: {},
      totalPrice: 0,
      rippleSlot: null,
    });
    if (this.slotRippleTimer) {
      clearTimeout(this.slotRippleTimer);
      this.slotRippleTimer = null;
    }
  },
  
  // 清空预订数据
  clearBookingData() {
    // 重新生成时间段和场地数据
    this.generateTimeSchedule();
    
    // 清空选中状态
    this.setData({
      selectedSlots: [],
      selectedSlotsMap: {},
      totalPrice: 0,
      rippleSlot: null,
    });
    
    // 清除动画定时器
    if (this.slotRippleTimer) {
      clearTimeout(this.slotRippleTimer);
      this.slotRippleTimer = null;
    }
  },
  
  onReady() {
    // 页面渲染完成后计算 content 高度
    this.calculateContentHeight();
  },
  
  // 计算 content 高度：100vh - header 高度 - 底部安全距离 - custom-tab-bar 高度
  calculateContentHeight() {
    const systemInfo = wx.getSystemInfoSync();
    const windowHeight = systemInfo.windowHeight; // 100vh 对应的像素值
    
    // 查询 header 和 tab-bar 的实际高度
    const query = wx.createSelectorQuery();
    query.select('.header').boundingClientRect();
    query.select('.tab-bar').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      const tabBarRect = res[1];
      
      // 获取 header 高度
      const headerHeight = headerRect ? headerRect.height : 0;
      
      // 如果查询不到 header，使用默认值（headerPaddingTop + 25）
      let finalHeaderHeight = headerHeight;
      if (!headerHeight || headerHeight === 0) {
        const app = getApp();
        let headerPaddingTop = 0;
        if (app && app.globalData && app.globalData.screenInfo && app.globalData.screenInfo.headerInfo) {
          headerPaddingTop = app.globalData.screenInfo.headerInfo.headerPaddingTop || 0;
        }
        finalHeaderHeight = headerPaddingTop + 25; // padding-top + title 高度
      }
      
      // 获取 tab-bar 高度
      const tabBarHeight = tabBarRect ? tabBarRect.height : 60; // 默认 60px
      
      // 计算底部安全距离：屏幕高度 - 安全区域底部
      const safeAreaBottom = systemInfo.safeArea 
        ? systemInfo.screenHeight - systemInfo.safeArea.bottom 
        : 0;
      
      const contentHeight = windowHeight - finalHeaderHeight - safeAreaBottom - tabBarHeight - 30;
      this.setData({
        contentHeight: Math.max(contentHeight, 400), // 最小高度 400px
      });
    });
  },
  
  // 生成最近两个月的日期列表
  generateDateList() {
    const dateList = [];
    const today = new Date();
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    
    // 获取今天的年月日，用于比较
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();
    const todayDate = today.getDate();
    
    // 生成未来60天的日期
    for (let i = 0; i < 60; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      
      const month = date.getMonth() + 1; // 月份（1-12）
      const day = date.getDate(); // 日期
      
      // 判断是否是今天
      const isToday = date.getFullYear() === todayYear && 
                      date.getMonth() === todayMonth && 
                      date.getDate() === todayDate;
      
      // 如果是今天，显示"今天"，否则显示星期几
      const weekday = isToday ? '今天' : weekdays[date.getDay()];
      
      // 格式化月份和日期，确保是两位数
      const monthStr = month < 10 ? `0${month}` : `${month}`;
      const dayStr = day < 10 ? `0${day}` : `${day}`;
      
      const dateStr = `${date.getFullYear()}-${monthStr}-${dayStr}`;
      
      dateList.push({
        weekday: weekday,
        monthDay: `${month}.${day}`, // 格式：3.6, 4.15
        date: date, // 保存完整日期对象，方便后续使用
        dateStr: dateStr, // 标准日期字符串
        isToday: isToday, // 标记是否是今天
      });
      
      // 如果是今天，设置为默认选中（不触发动画）
      if (isToday && !this.data.selectedDate) {
        this.setData({
          selectedDate: dateStr,
        });
      }
    }
    
    this.setData({
      dateList: dateList,
    });
  },
  
  // 处理日期点击事件
  handleDateClick(e) {
    const { datestr } = e.currentTarget.dataset;
    if (datestr) {
      // 清除之前的定时器
      if (this.rippleTimer) {
        clearTimeout(this.rippleTimer);
        this.rippleTimer = null;
      }
      
      // 切换日期时更新场地可预订状态
      this.updateSlotsAvailability(datestr);
      // 先清除旧的波纹状态，确保动画能重新触发
      this.setData({
        selectedDate: datestr,
        rippleDate: '',
      }, () => {
        // 在 setData 回调中触发动画，确保 DOM 已更新
        // 使用 requestAnimationFrame 优化动画时机
        if (typeof requestAnimationFrame !== 'undefined') {
          requestAnimationFrame(() => {
            this.setData({
              rippleDate: datestr, // 触发波纹动画
            });
            
            // 动画结束后清除波纹状态
            this.rippleTimer = setTimeout(() => {
              this.setData({
                rippleDate: '',
              });
              this.rippleTimer = null;
            }, 600); // 动画持续时间
          });
        } else {
          // 兼容性处理
          setTimeout(() => {
            this.setData({
              rippleDate: datestr, // 触发波纹动画
            });
            
            // 动画结束后清除波纹状态
            this.rippleTimer = setTimeout(() => {
              this.setData({
                rippleDate: '',
              });
              this.rippleTimer = null;
            }, 600); // 动画持续时间
          }, 16); // 约一帧的时间
        }
      });
    }
  },
  
  // 生成时间段和场地数据
  generateTimeSchedule() {
    // 生成时间段：8:00-22:00
    const timeSlots = [];
    for (let hour = 8; hour <= 22; hour++) {
      const hourStr = hour < 10 ? `0${hour}` : `${hour}`;
      timeSlots.push({
        time: `${hourStr}:00`,
        hour: hour,
      });
    }

    const selectedDate = this.data.selectedDate || this.getTodayDateStr();

    // 生成两个场地的数据
    const courts = [
      {
        id: 1,
        name: '1号场',
        slots: this.generateCourtSlots(timeSlots, selectedDate),
      },
      {
        id: 2,
        name: '2号场',
        slots: this.generateCourtSlots(timeSlots, selectedDate),
      },
    ];

    this.setData({
      timeSlots: timeSlots,
      courts: courts,
    });
  },

  // 获取今日日期字符串
  getTodayDateStr() {
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    return `${today.getFullYear()}-${month < 10 ? '0' + month : month}-${day < 10 ? '0' + day : day}`;
  },

  // 生成场地的可预订时间段：当前时间以前的不可用，以后的都可预订
  generateCourtSlots(timeSlots, selectedDate) {
    const slots = [];
    const price = 100; // 默认价格

    const now = new Date();
    const todayStr = this.getTodayDateStr();

    for (let i = 0; i < timeSlots.length; i++) {
      const slotHour = timeSlots[i].hour;
      let isAvailable = false;

      if (selectedDate > todayStr) {
        // 未来日期：全部可预订
        isAvailable = true;
      } else if (selectedDate === todayStr) {
        // 今天：当前时间以后的才可预订
        const slotTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), slotHour, 0, 0);
        isAvailable = slotTime > now;
      }

      slots.push({
        available: isAvailable,
        price: isAvailable ? price : null,
        booked: false,
      });
    }

    return slots;
  },

  // 切换日期时更新场地可预订状态
  updateSlotsAvailability(selectedDate) {
    const { timeSlots, courts } = this.data;
    const now = new Date();
    const todayStr = this.getTodayDateStr();

    const newCourts = courts.map((court) => ({
      ...court,
      slots: court.slots.map((slot, i) => {
        const slotHour = timeSlots[i].hour;
        let isAvailable = false;

        if (selectedDate > todayStr) {
          isAvailable = true;
        } else if (selectedDate === todayStr) {
          const slotTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), slotHour, 0, 0);
          isAvailable = slotTime > now;
        }

        return {
          ...slot,
          available: isAvailable,
          price: isAvailable ? 100 : null,
        };
      }),
    }));

    this.setData({
      courts: newCourts,
      selectedSlots: [],
      selectedSlotsMap: {},
      totalPrice: 0,
    });
  },
  
  // 处理时间段点击事件
  handleSlotClick(e) {
    const { courtid, slotindex } = e.currentTarget.dataset;
    if (!courtid || slotindex === undefined) return;
    
    const courtId = parseInt(courtid);
    const slotIndex = parseInt(slotindex);
    
    // 检查该时间段是否可选
    const court = this.data.courts.find(c => c.id === courtId);
    if (!court || !court.slots[slotIndex] || !court.slots[slotIndex].available) {
      return;
    }
    
    // 清除之前的定时器
    if (this.slotRippleTimer) {
      clearTimeout(this.slotRippleTimer);
      this.slotRippleTimer = null;
    }
    
    // 检查是否已选中
    const slotKey = `${courtId}-${slotIndex}`;
    const isSelected = this.data.selectedSlots.some(
      s => s.courtId === courtId && s.slotIndex === slotIndex
    );
    
    // 切换选中状态
    let newSelectedSlots = [...this.data.selectedSlots];
    let newSelectedSlotsMap = { ...this.data.selectedSlotsMap };
    
    if (isSelected) {
      newSelectedSlots = newSelectedSlots.filter(
        s => !(s.courtId === courtId && s.slotIndex === slotIndex)
      );
      delete newSelectedSlotsMap[`${courtId}-${slotIndex}`];
    } else {
      newSelectedSlots.push({ courtId, slotIndex });
      newSelectedSlotsMap[`${courtId}-${slotIndex}`] = true;
    }
    
    // 合并 setData，减少渲染次数
    // 计算总价
    const totalPrice = this.calculateTotalPrice(newSelectedSlots);
    
    // 先清除旧的波纹状态，确保动画能重新触发
    this.setData({
      selectedSlots: newSelectedSlots,
      selectedSlotsMap: newSelectedSlotsMap,
      totalPrice: totalPrice,
      rippleSlot: null,
    }, () => {
      // 在 setData 回调中触发动画，确保 DOM 已更新
      // 使用 requestAnimationFrame 优化动画时机
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => {
          this.setData({
            rippleSlot: { courtId, slotIndex }, // 触发波纹动画
          });
          
          // 动画结束后清除波纹状态
          this.slotRippleTimer = setTimeout(() => {
            this.setData({
              rippleSlot: null,
            });
            this.slotRippleTimer = null;
          }, 600); // 动画持续时间
        });
      } else {
        // 兼容性处理
        setTimeout(() => {
          this.setData({
            rippleSlot: { courtId, slotIndex }, // 触发波纹动画
          });
          
          // 动画结束后清除波纹状态
          this.slotRippleTimer = setTimeout(() => {
            this.setData({
              rippleSlot: null,
            });
            this.slotRippleTimer = null;
          }, 600); // 动画持续时间
        }, 16); // 约一帧的时间
      }
    });
  },
  
  // 计算总价
  calculateTotalPrice(selectedSlots) {
    if (!selectedSlots || selectedSlots.length === 0) {
      return 0;
    }
    
    let total = 0;
    selectedSlots.forEach(slot => {
      const court = this.data.courts.find(c => c.id === slot.courtId);
      if (court && court.slots[slot.slotIndex] && court.slots[slot.slotIndex].available) {
        total += court.slots[slot.slotIndex].price || 0;
      }
    });
    
    return total;
  },
  
  // 处理确认预订
  handleConfirmBooking() {
    if (this.data.selectedSlots.length === 0) {
      wx.showToast({
        title: '请选择时间段',
        icon: 'none',
      });
      return;
    }
    
    // 跳转到订单详情页
    const selectedSlots = encodeURIComponent(JSON.stringify(this.data.selectedSlots));
    const selectedDate = encodeURIComponent(this.data.selectedDate);
    const courts = encodeURIComponent(JSON.stringify(this.data.courts));
    
    wx.navigateTo({
      url: `/pages/order-detail/index?selectedSlots=${selectedSlots}&selectedDate=${selectedDate}&courts=${courts}`,
    });
  },
});
