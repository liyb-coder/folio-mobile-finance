const runtimeConfig = require("../../config/runtime");
const { createReviewProposal } = require("../../services/review-proposals");

Page({
  data: {
    selectedMode: "voice",
    status: "idle",
    textValue: "",
    proposal: null,
    errorMessage: "",
  },
  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 2 });
  },
  selectMode(event) {
    this.setData({
      selectedMode: event.currentTarget.dataset.mode,
      status: "idle",
      proposal: null,
      errorMessage: "",
    });
  },
  updateText(event) {
    this.setData({ textValue: event.detail.value, errorMessage: "" });
  },
  async submitText() {
    const text = String(this.data.textValue || "").trim();
    if (!text) {
      wx.showToast({ title: "先写下刚刚发生的变化", icon: "none" });
      return;
    }
    if (!runtimeConfig.bffBaseUrl) {
      this.setData({ errorMessage: "测试服务地址尚未配置，内容没有离开本机。" });
      return;
    }
    this.setData({ status: "submitting", errorMessage: "", proposal: null });
    try {
      const sourceId = `text-${Date.now()}`;
      const proposal = await createReviewProposal({
        baseUrl: runtimeConfig.bffBaseUrl,
        sourceId,
        sourceKind: "text",
        text,
      });
      this.setData({ status: "review", proposal, textValue: "" });
    } catch (error) {
      this.setData({
        status: "error",
        errorMessage: error && error.message ? error.message : "暂时无法整理，请稍后再试。",
      });
    }
  },
  resetTextCapture() {
    this.setData({ status: "idle", proposal: null, errorMessage: "" });
  },
  showPending() {
    wx.showToast({ title: "下一里程碑接入", icon: "none" });
  }
});
