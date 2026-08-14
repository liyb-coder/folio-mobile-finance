const fixtures = require("../../data/demo-fixtures");

Page({
  data: { summary: fixtures.summary },
  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 0 });
  },
  openCashflow() {
    wx.navigateTo({ url: "/pages/cashflow/index" });
  }
});
