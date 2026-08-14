const fixtures = require("../../data/demo-fixtures");

Page({
  data: { summary: fixtures.summary, accounts: fixtures.accounts },
  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 1 });
  },
  showPending() {
    wx.showToast({ title: "下一里程碑接入", icon: "none" });
  }
});
