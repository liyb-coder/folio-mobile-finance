const fixtures = require("../../data/demo-fixtures");

Page({
  data: { reminders: fixtures.reminders },
  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 3 });
  },
  showPending() {
    wx.showToast({ title: "下一里程碑接入", icon: "none" });
  }
});
