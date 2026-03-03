const courts = [
  {
    id: "court-01",
    name: "昂湃中心一号场",
    price: 120,
    location: "滨江网球中心",
    coverImage: "https://picsum.photos/seed/tennis-venue-1/1200/600",
    distance: "770.2km"
  },
  {
    id: "court-02",
    name: "海风二号场",
    price: 100,
    location: "海风运动公园",
    coverImage: "https://picsum.photos/seed/tennis-venue-2/1200/600",
    distance: "771.6km"
  }
];

const coaches = [
  {
    id: "coach-01",
    name: "李晨",
    level: "国家一级教练",
    price: 280,
    tags: ["发球提升", "体能强化"],
    avatarText: "Coach A"
  },
  {
    id: "coach-02",
    name: "吴颖",
    level: "青少年专项",
    price: 240,
    tags: ["基本功", "小组课"],
    avatarText: "Coach B"
  }
];

const activities = [
  {
    id: "act-01",
    title: "周末畅打",
    type: "畅打",
    date: "周六 14:00-16:00",
    status: "开放报名",
    coverText: "Matchplay"
  },
  {
    id: "act-02",
    title: "月度积分赛",
    type: "比赛",
    date: "周日 10:00-12:00",
    status: "名额紧张",
    coverText: "Tournament"
  },
  {
    id: "act-03",
    title: "团课训练营",
    type: "团课",
    date: "每周三 19:30-21:00",
    status: "开放报名",
    coverText: "Group Class"
  }
];

const products = [
  {
    id: "prod-01",
    name: "高弹训练球 12 颗",
    price: 129,
    tag: "训练必备",
    coverText: "Ball"
  },
  {
    id: "prod-02",
    name: "入门球拍",
    price: 399,
    tag: "新品推荐",
    coverText: "Racket"
  }
];

const orders = [
  {
    id: "order-01",
    type: "场地订单",
    title: "昂湃中心一号场",
    time: "2026-01-28 19:00-20:00",
    status: "已支付"
  },
  {
    id: "order-02",
    type: "课程订单",
    title: "李晨 · 私教课",
    time: "2026-01-30 20:00-21:00",
    status: "待确认"
  }
];

const user = {
  name: "网球学员",
  phone: "138****3322",
  points: 320,
  credits: 6,
  serveMachine: 3
};

module.exports = {
  courts,
  coaches,
  activities,
  products,
  orders,
  user
};
