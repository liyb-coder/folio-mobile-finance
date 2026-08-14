Page({
  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 4 });
  },
  openCapture() {
    wx.switchTab({ url: "/pages/capture/index" });
  },
  showPending() {
    wx.showToast({ title: "下一里程碑接入", icon: "none" });
  }
});
