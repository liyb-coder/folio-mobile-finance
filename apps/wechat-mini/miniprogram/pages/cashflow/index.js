const fixtures = require("../../data/demo-fixtures");

Page({
  data: { cashflow: fixtures.cashflow },
  onShow() {},
  showPending() {
    wx.showToast({ title: "下一里程碑接入", icon: "none" });
  }
});
